require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const axios = require('axios');

// --- KONFIGURASI ---
const PORT = process.env.PORT || 4000;
const MONGO_URI = process.env.MONGO_URI;
const TRIPAY_PRIVATE_KEY = process.env.TRIPAY_PRIVATE_KEY;
const BOT_TOKEN = process.env.BOT_TOKEN;

// --- KONEKSI DATABASE & MODEL ---
// Untuk simplifikasi, skema didefinisikan di sini. Anda juga bisa memisahkannya ke folder /models.
mongoose.connect(MONGO_URI).then(() => console.log('🔗 Callback Server terhubung ke MongoDB...'));

const User = mongoose.model('User', new mongoose.Schema({ telegramId: Number, balance: Number }));
const Transaction = mongoose.model('Transaction', new mongoose.Schema({
  merchantRef: { type: String, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  amount: Number,
  status: String,
}));

// --- FUNGSI HELPER ---
const sendTelegramMessage = async (chatId, text) => {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  try {
    await axios.post(url, { chat_id: chatId, text, parse_mode: 'Markdown' });
    console.log(`Pesan konfirmasi terkirim ke user ${chatId}`);
  } catch (error) {
    console.error("Gagal mengirim pesan via API Telegram:", error.response?.data || error.message);
  }
};

const validateSignature = (jsonResponse, signatureFromHeader) => {
  const calculatedSignature = crypto
    .createHmac('sha266', TRIPAY_PRIVATE_KEY)
    .update(JSON.stringify(jsonResponse))
    .digest('hex');
  return signatureFromHeader === calculatedSignature;
};

// --- INISIALISASI SERVER EXPRESS ---
const app = express();
app.use(express.json());

app.get('/', (req, res) => res.send('Callback server is alive!'));

app.post('/callback', async (req, res) => {
  if (!validateSignature(req.body, req.headers['x-callback-signature'])) {
    return res.status(400).json({ success: false, message: 'Invalid Signature' });
  }

  if (req.headers['x-callback-event'] !== 'payment_status' || req.body.status !== 'PAID') {
    return res.status(200).json({ success: true, message: 'Event ignored' });
  }

  try {
    const transaction = await Transaction.findOneAndUpdate(
      { merchantRef: req.body.merchant_ref, status: 'PENDING' },
      { status: 'PAID' }
    ).populate('user');

    if (transaction?.user) {
      const user = transaction.user;
      user.balance += transaction.amount;
      await user.save();

      const message = `🎉 Pembayaran berhasil!\n\nDeposit *Rp ${transaction.amount.toLocaleString('id-ID')}* telah masuk.\nSaldo baru: *Rp ${user.balance.toLocaleString('id-ID')}*`;
      await sendTelegramMessage(user.telegramId, message);
    }
  } catch (error) {
    console.error('Error memproses callback:', error);
  }

  res.status(200).json({ success: true });
});

app.listen(PORT, () => {
  console.log(`📞 Callback Server berjalan di port ${PORT}`);
});
