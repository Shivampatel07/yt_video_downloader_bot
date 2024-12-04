const TelegramBot = require('node-telegram-bot-api');
const ytdl = require('ytdl-core');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
require('dotenv').config();

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

const downloadsDir = path.join(__dirname, 'downloads');

// Ensure the downloads directory exists
if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir, { recursive: true });
}

// Command to check if `yt-dlp` is installed
const isYtDlpAvailable = () => {
    return new Promise((resolve, reject) => {
        exec('yt-dlp --version', (error, stdout) => {
            if (error) {
                reject(false);
            } else {
                resolve(true);
            }
        });
    });
};

// Start Command
bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, 'Send a YouTube URL to get the video.');
});

// Message Handler
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const url = msg.text;

    if (ytdl.validateURL(url)) {
        bot.sendMessage(chatId, 'Downloading your video...');
        const outputPath = path.join(downloadsDir, 'video.mp4');

        try {
            const videoStream = ytdl(url, { quality: 'highestvideo' });
            const writeStream = fs.createWriteStream(outputPath);
            videoStream.pipe(writeStream);

            writeStream.on('finish', () => {
                bot.sendMessage(chatId, 'Download complete. Sending the video...');
                bot.sendVideo(chatId, outputPath).then(() => {
                    fs.unlinkSync(outputPath); // Clean up
                });
            });

            writeStream.on('error', (err) => {
                console.error('Stream Write Error:', err);
                bot.sendMessage(chatId, 'An error occurred during the download.');
            });
        } catch (err) {
            console.error('ytdl-core Error:', err);
            bot.sendMessage(chatId, 'Error using ytdl-core. Trying yt-dlp...');
            fallbackToYtDlp(chatId, url);
        }
    } else {
        bot.sendMessage(chatId, 'Please send a valid YouTube URL.');
    }
});

// Fallback to yt-dlp
async function fallbackToYtDlp(chatId, url) {
    const outputPath = path.join(downloadsDir, 'video.mp4');
    const ytDlpAvailable = await isYtDlpAvailable();

    if (!ytDlpAvailable) {
        bot.sendMessage(chatId, 'yt-dlp is not installed on the server. Please install it.');
        return;
    }

    const command = `yt-dlp -f best -o "${outputPath}" ${url}`;
    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error('yt-dlp Error:', error);
            bot.sendMessage(chatId, 'An error occurred while using yt-dlp.');
            return;
        }

        bot.sendMessage(chatId, 'Download complete using yt-dlp. Sending the video...');
        bot.sendVideo(chatId, outputPath).then(() => {
            fs.unlinkSync(outputPath); // Clean up
        }).catch(err => {
            console.error('Error Sending Video:', err);
            bot.sendMessage(chatId, 'Failed to send the video.');
        });
    });
}
