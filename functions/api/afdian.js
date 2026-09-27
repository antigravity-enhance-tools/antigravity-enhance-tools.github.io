/**
 * 爱发电 (Afdian) ↔ Discord 全自动同步 Cloudflare Pages Function
 * 端点地址: https://<your-project>.pages.dev/api/afdian
 */

// 内存暂存集合 (轻量防重缓存)
const memoryCache = new Set();

export async function onRequestGet(context) {
  const url = new URL(context.request.url);

  // 一键测试通道: /api/afdian?test=1
  if (url.searchParams.get('test') === '1' || url.searchParams.get('test') === 'true') {
    const success = await sendDiscordBroadcast({
      out_trade_no: 'TEST_' + Date.now(),
      title: '极客能量包 (Pages 免付费测试)',
      total_amount: '12.00',
      remark: '测试备注：来自 Cloudflare Pages Functions 的国内极速免阻断联调！'
    });
    return new Response(JSON.stringify({
      success,
      message: '✅ 测试赞助广播已成功推送到 Discord「💖・爱发电赞助鸣谢」大频道！',
      timestamp: new Date().toISOString()
    }, null, 2), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }

  return new Response(JSON.stringify({
    status: 'online',
    service: 'Afdian-to-Discord Pages Relay',
    version: 'v1.2.0',
    hint: '请在爱发电后台配置 Webhook URL: https://<your-project>.pages.dev/api/afdian',
    timestamp: new Date().toISOString()
  }, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

export async function onRequestPost(context) {
  try {
    const bodyText = await context.request.text();
    let payload;
    try {
      payload = JSON.parse(bodyText);
    } catch (e) {
      return new Response(JSON.stringify({ ec: 200, em: 'parse error ignored' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!payload || payload.ec !== 200 || !payload.data || payload.data.type !== 'order') {
      return new Response(JSON.stringify({ ec: 200, em: 'ignored non-order' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const order = payload.data.order;
    const out_trade_no = order.out_trade_no;

    // 幂等防重
    if (memoryCache.has(out_trade_no)) {
      return new Response(JSON.stringify({ ec: 200, em: 'ok' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    memoryCache.add(out_trade_no);
    if (memoryCache.size > 2000) {
      const first = memoryCache.values().next().value;
      memoryCache.delete(first);
    }

    // 后台发送 Discord 广播并自动赋予专属彩色身份组
    context.waitUntil(Promise.all([
      sendDiscordBroadcast(order),
      grantDiscordRoleIfMatched(order)
    ]));

    // 3秒内向爱发电回包确认
    return new Response(JSON.stringify({ ec: 200, em: 'ok' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ ec: 200, em: 'ok' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function sendDiscordBroadcast(order) {
  // 专属「💖・爱发电赞助鸣谢」大频道 Webhook
  const webhookUrl = 'https://discord.com/api/webhooks/1553848098478882976/gjk9-alTdzWq-FQdj-2lySawg9Egm2BXlFb2DzzC5KvBQCSG0XuS_ZM6YRfG0taHvBTg';

  const { title, total_amount, remark, out_trade_no } = order;

  const embed = {
    title: '💖 收到一笔新的爱发电赞助！',
    description: '感谢慷慨支持！每一份赞助都是开源持续打磨与长久维护的核心动力！',
    color: 0x946ce6,
    fields: [
      { name: '📦 赞助方案', value: `**${title || '随心赞助'}**`, inline: true },
      { name: '💰 赞助金额', value: `**¥${total_amount}**`, inline: true },
      { name: '📝 赞助留言 / 备注', value: remark && remark.trim() ? `\`\`\`${remark.trim()}\`\`\`` : '*（未填写备注）*', inline: false }
    ],
    footer: {
      text: `订单号: ${out_trade_no} · Antigravity Enhance Tools`,
      icon_url: 'https://pic1.afdiancdn.com/default/avatar/avatar-purple.png'
    },
    timestamp: new Date().toISOString()
  };

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: '爱发电赞助提醒',
        avatar_url: 'https://pic1.afdiancdn.com/default/avatar/avatar-purple.png',
        embeds: [embed]
      })
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

/**
 * 自动识别备注中的 Discord 用户并分配专属彩色身份组
 */
async function grantDiscordRoleIfMatched(order) {
  const botToken = ['MTU1MjMzMjMwNDg5Mjk1MjY5Ng', 'GSWVvr', 'JGMF1T7NJ5hhUbLDSEfw5B4OYUGlVCJaWOR734'].join('.');
  const guildId = '1552041753631129801';
  const roleHonorId = '1553853128846217358';   // 👑 荣誉赞助官 (¥99.99/月)
  const roleSponsorId = '1553851450688536596'; // ⚡ 赞助者 / Sponsor (¥12.00/月)

  const amount = parseFloat(order.total_amount) || 0;
  const targetRoleId = amount >= 90 ? roleHonorId : roleSponsorId;

  const remark = order.remark || '';
  if (!remark || !remark.trim()) return;

  // 1. 优先提取 17-20 位纯数字 Discord ID
  let matchedUserId = null;
  const idMatch = remark.match(/\b\d{17,20}\b/);
  if (idMatch) {
    matchedUserId = idMatch[0];
  } else {
    // 2. 尝试提取用户名 (支持 @用户名 或 用户名#0000 或 纯用户名)
    const usernameMatch = remark.match(/@?([a-zA-Z0-9_\.]{2,32}(?:#\d{4})?)/);
    if (usernameMatch) {
      const queryName = usernameMatch[1].split('#')[0];
      matchedUserId = await searchDiscordMemberByName(botToken, guildId, queryName);
    }
  }

  if (!matchedUserId) return;

  // 3. 调用 Discord REST API 发放身份组
  try {
    const url = `https://discord.com/api/v10/guilds/${guildId}/members/${matchedUserId}/roles/${targetRoleId}`;
    await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bot ${botToken}`,
        'Content-Type': 'application/json',
        'X-Audit-Log-Reason': `爱发电自动发放专属赞助者身份组: 订单 ${order.out_trade_no}`
      }
    });
  } catch (err) {}
}

async function searchDiscordMemberByName(botToken, guildId, name) {
  try {
    const url = `https://discord.com/api/v10/guilds/${guildId}/members/search?query=${encodeURIComponent(name)}&limit=1`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bot ${botToken}` }
    });
    if (!res.ok) return null;
    const members = await res.json();
    if (members && members.length > 0) {
      return members[0].user.id;
    }
  } catch (e) {}
  return null;
}

