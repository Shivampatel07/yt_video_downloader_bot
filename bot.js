const TelegramBot = require('node-telegram-bot-api');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Configuration
const token = process.env.TELEGRAM_BOT_TOKEN;
const DOWNLOAD_DIR = path.resolve(__dirname, 'downloads');
const MAX_DAILY_DOWNLOADS = 5;
const MAX_VIDEO_DURATION = 30 * 60; // 30 minutes in seconds

// Ensure download directory exists
if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
    console.log(`Created download directory: ${DOWNLOAD_DIR}`);
}

// User Download Tracker
class UserDownloadTracker {
    constructor() {
        this.userDownloads = {};
    }

    canDownload(userId) {
        if (!this.userDownloads[userId]) {
            this.userDownloads[userId] = { count: 0, timestamp: Date.now() };
        }

        const now = Date.now();
        if (now - this.userDownloads[userId].timestamp > 24 * 60 * 60 * 1000) {
            this.userDownloads[userId].count = 0;
            this.userDownloads[userId].timestamp = now;
        }

        return this.userDownloads[userId].count < MAX_DAILY_DOWNLOADS;
    }

    incrementDownload(userId) {
        this.userDownloads[userId].count++;
    }
}
const tracker = new UserDownloadTracker();

// Utility Functions
function isValidYoutubeUrl(url) {
    const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.*$/;
    return youtubeRegex.test(url);
}

function sanitizeFilename(title) {
    
    const ext = path.extname(title); // Get the file extension
    const baseName = path.basename(title, ext); // Get the base name without the extension

    // Sanitize the base name, replace non-alphanumeric characters with underscores
    const sanitizedBaseName = baseName.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);

    // Return the sanitized filename with the extension back
    return sanitizedBaseName + ext;
}


function safeDeleteFile(filePath) {
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }
}

// Get video metadata
function getVideoMetadata(url) {
    return new Promise((resolve, reject) => {
        const command = `yt-dlp --dump-json "${url}"`;
        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(`Metadata fetch error: ${stderr}`);
                reject(stderr);
                return;
            }

            try {
                const metadata = JSON.parse(stdout);
                resolve(metadata);
            } catch (parseError) {
                reject('Failed to parse metadata');
            }
        });
    });
}

// Bot Setup
const bot = new TelegramBot(token, { polling: true });

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from.first_name || 'User';

    const welcomeMessage =
        `👋 Welcome, ${username}!

` +
        `I can help you download YouTube videos or audio. Here's what I can do:
` +
        `• You have ${MAX_DAILY_DOWNLOADS} downloads per day.
` +
        `• Send me a YouTube link.
` +
        `• Choose your desired format.

` +
        `Let's get started! 🚀`;

    bot.sendMessage(chatId, welcomeMessage);
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!isValidYoutubeUrl(text)) return;

    if (!tracker.canDownload(chatId)) {
        bot.sendMessage(chatId, `❌ You've reached your daily download limit of ${MAX_DAILY_DOWNLOADS} downloads.`);
        return;
    }

    bot.sendMessage(chatId, '⏳ Fetching video metadata...');

    try {
        const metadata = await getVideoMetadata(text);
        const duration = metadata.duration;
        const title = sanitizeFilename(metadata.title);

        if (duration <= MAX_VIDEO_DURATION) {
            // Less than 30 minutes: show all options
            const options = {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '360p', callback_data: `video_360p_${text}` },
                            { text: '240p', callback_data: `video_240p_${text}` },
                            { text: '144p', callback_data: `video_144p_${text}` },
                        ],
                        [{ text: 'MP3 (Audio)', callback_data: `audio_audio_${text}` }],
                    ],
                },
            };
            bot.sendMessage(chatId, 'Choose download format:', options);
        } else if (duration <= 60 * 60) {
            // Between 30 minutes and 1 hour: only audio option
            const options = {
                reply_markup: {
                    inline_keyboard: [[{ text: 'MP3 (Audio)', callback_data: `audio_${text}` }]],
                },
            };
            bot.sendMessage(chatId, 'Video is longer than 30 minutes. Only audio download is available:', options);
        } else {
            // More than 1 hour: send error message
            bot.sendMessage(chatId, '❌ The video exceeds the 1-hour limit and cannot be downloaded.');
        }
    } catch (error) {
        console.error('Metadata fetch error:', error);
        bot.sendMessage(chatId, '❌ Failed to fetch video metadata. Please try again.');
    }
});

bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;
    const [type, format, url] = data.split('_');

    if (!url || url === 'undefined') {
        await bot.sendMessage(chatId, '❌ Invalid URL. Please try again with a valid YouTube link.');
        return;
    }

    const formatMapping = {
        '360p': '18',
        '240p': '18',
        '144p': '18',
        'audio': 'bestaudio',
    };

    const selectedFormat = formatMapping[format] || 'best';
    const extension = type === 'audio' ? 'mp3' : 'mp4';

    const processingMessage = await bot.sendMessage(chatId, '⏳ Processing your download...');
    let outputPath;

    try {
        const outputFilename = sanitizeFilename(`download_${Date.now()}.${extension}`);
        outputPath = path.resolve(DOWNLOAD_DIR, outputFilename);

        const command = `yt-dlp -f ${selectedFormat} -o "${outputPath}" "${url}"`;
        await new Promise((resolve, reject) => {
            exec(command, (error) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve();
            });
        });

        if (type === 'audio') {
            await bot.sendAudio(chatId, outputPath, {}, { contentType: 'audio/mpeg' });
        } else {
            await bot.sendDocument(chatId, outputPath, {}, { contentType: 'application/octet-stream' });
        }

        tracker.incrementDownload(chatId);

        await bot.editMessageText(`✅ Download complete! (${tracker.userDownloads[chatId].count}/${MAX_DAILY_DOWNLOADS} downloads used today)`, {
            chat_id: chatId,
            message_id: processingMessage.message_id,
        });
    } catch (error) {
        console.error('Download error:', error);
        await bot.editMessageText('❌ An error occurred while processing your request. Please try again.', {
            chat_id: chatId,
            message_id: processingMessage.message_id,
        });
    } finally {
        if (outputPath) {
            safeDeleteFile(outputPath);
        }
    }
});


console.log('YouTube Download Bot is running...');
