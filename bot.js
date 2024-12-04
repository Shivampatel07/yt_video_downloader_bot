const TelegramBot = require('node-telegram-bot-api');
const ytdl = require('ytdl-core');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

const downloadsDir = path.join(__dirname, 'downloads');

// Ensure the downloads directory exists
if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir, { recursive: true });
}

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, 'Send a YouTube URL to get the video.');
});

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
            console.error('Download Error:', err);
            bot.sendMessage(chatId, 'Error downloading the video.');
        }
    } else {
        bot.sendMessage(chatId, 'Please send a valid YouTube URL.');
    }
});