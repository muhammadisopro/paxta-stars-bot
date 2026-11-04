import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const chatIdFile = path.join(rootDir, 'telegram_chat.json');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '7977698448:AAESg-KtnelLbI8OZSFZbHNTC5P_45yj_2o';
let activeChatId = process.env.TELEGRAM_CHAT_ID || null;

if (!activeChatId && fs.existsSync(chatIdFile)) {
  try {
    const data = JSON.parse(fs.readFileSync(chatIdFile, 'utf8'));
    activeChatId = data.chatId;
  } catch {}
}

export class TelegramNotifier {
  constructor() {
    this.token = BOT_TOKEN;
    this.chatId = activeChatId;
    this.offset = 0;
    this.startListener();
  }

  async startListener() {
    console.log(`🤖 Telegram Bot (@ArklonBot) tinglovchisi ishga tushdi...`);
    // Poll updates to catch user /start and remember chat_id
    setInterval(async () => {
      try {
        const res = await fetch(`https://api.telegram.org/bot${this.token}/getUpdates?offset=${this.offset}&timeout=10`);
        if (!res.ok) return;
        const data = await res.json();
        for (const u of data.result || []) {
          this.offset = Math.max(this.offset, u.update_id + 1);
          const msg = u.message;
          if (msg && msg.chat?.id) {
            const newChatId = msg.chat.id;
            if (this.chatId !== newChatId) {
              this.chatId = newChatId;
              try {
                fs.writeFileSync(chatIdFile, JSON.stringify({ chatId: newChatId, username: msg.from?.username }));
              } catch {}
              console.log(`🎯 Yangi Telegram Chat ID ulandi: ${newChatId} (@${msg.from?.username || ''})`);
              await this.sendMessage(`✅ <b>Paxta Stars Bot ulandi!</b>\n\nBarcha 8 ta akkauntingizning promokod va NFT xarid hisobotlari to'liq shu yerga yuboriladi.`);
            }
          }
        }
      } catch (err) {
        // ignore polling network errors
      }
    }, 3000);
  }

  async sendMessage(text) {
    if (!this.chatId) {
      console.log(`⚠️ Telegram Chat ID hali aniqlanmadi. Iltimos @ArklonBot ga kirib bitta /start bosing.`);
      return false;
    }

    try {
      const res = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true
        })
      });
      return res.ok;
    } catch (err) {
      console.error('Telegram xabar yuborishda xato:', err.message);
      return false;
    }
  }

  async sendFullReport(report) {
    let msg = `🔥 <b>YANGI PROMO-KOD USHLANDI:</b> <code>${report.code}</code>\n`;
    if (report.source) {
      msg += `👤 <b>Yuboruvchi:</b> @${report.source.sender} (Guruh: ${report.source.chat})\n`;
      msg += `💬 <b>Asl xabar:</b> <i>"${report.source.text}"</i>\n`;
    }
    msg += `⏰ <b>Vaqt:</b> ${report.time}\n\n`;

    msg += `📊 <b>AKKAUNTLAR BO'YICHA TO'LIQ HISOBOT:</b>\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;

    let totalGifts = 0;
    for (const r of report.accounts) {
      msg += `👤 <b>@${r.username}</b>:\n`;
      msg += `  • StarsBot holati: ${r.statusText || 'Faollashtirildi'}\n`;
      msg += `  • Boshlang'ich (himoyalangan) hisob: <code>${r.initialStars} ⭐</code>\n`;

      if (r.bought && r.bought.length > 0) {
        msg += `  • 🛒 <b>Xaridlar:</b>\n`;
        for (const b of r.bought) {
          totalGifts++;
          if (b.type === 'nft') {
            msg += `     🎁 <b>NFT:</b> ${b.title} #${b.number} (${b.price} ⭐)\n`;
          } else {
            msg += `     🎂 <b>Do'kon Sovg'asi:</b> ${b.title} (${b.price} ⭐)\n`;
          }
        }
      } else {
        msg += `  • 🛒 Xaridlar: Qo'shimcha xarid qilinmadi\n`;
      }
      msg += `\n`;
    }

    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `🎁 <b>Jami xarid qilingan NFT va sovg'alar:</b> ${totalGifts} ta\n`;
    msg += `🛡️ <i>Barcha eski Stars balanslari 100% tegilmasdan saqlandi.</i>`;

    return await this.sendMessage(msg);
  }
}
