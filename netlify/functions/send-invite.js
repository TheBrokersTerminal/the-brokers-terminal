const https = require('https');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  const { email, firmName, inviteUrl, adminName } = body;
  if (!email || !inviteUrl) return { statusCode: 400, body: 'Missing email or inviteUrl' };

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('RESEND_API_KEY is not set');
    return { statusCode: 500, body: 'RESEND_API_KEY not configured' };
  }

  console.log('Sending invite to:', email, '| key prefix:', apiKey.slice(0, 8));

  const payload = JSON.stringify({
    from: 'The Brokers Terminal <admin@thebrokersterminal.com>',
    to: [email],
    subject: "You've been invited to The Brokers Terminal",
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:'Courier New',Courier,monospace;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#0f0f0f;border:1px solid #1e1e1e;border-top:3px solid #E97132;max-width:560px;width:100%;">
        <tr><td style="padding:28px 32px;border-bottom:1px solid #1a1a1a;">
          <span style="color:#E97132;font-size:11px;letter-spacing:0.25em;font-weight:700;text-transform:uppercase;">█ THE BROKERS TERMINAL</span>
        </td></tr>
        <tr><td style="padding:36px 32px;">
          <p style="color:#888;font-size:9px;letter-spacing:0.3em;text-transform:uppercase;margin:0 0 16px;">YOU HAVE BEEN INVITED</p>
          <h1 style="color:#ffffff;font-size:18px;letter-spacing:0.12em;text-transform:uppercase;margin:0 0 20px;font-weight:700;line-height:1.4;">
            ${adminName ? adminName + ' has invited<br>you to join' : 'Join'} ${firmName || 'your firm'} on<br>The Brokers Terminal
          </h1>
          <p style="color:#888;font-size:12px;letter-spacing:0.06em;line-height:1.8;margin:0 0 32px;">
            You've been added to your firm's desk on The Brokers Terminal — the intelligence platform built for whisky and gold investment brokers. Click below to set up your account and get access.
          </p>
          <table cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
            <tr><td style="background:#E97132;">
              <a href="${inviteUrl}" style="display:inline-block;padding:14px 32px;color:#000000;font-size:10px;font-weight:700;letter-spacing:0.25em;text-transform:uppercase;text-decoration:none;">
                ▸ SET UP YOUR ACCOUNT
              </a>
            </td></tr>
          </table>
          <p style="color:#555;font-size:10px;letter-spacing:0.08em;line-height:1.8;margin:0 0 8px;">Or copy this link into your browser:</p>
          <p style="color:#E97132;font-size:10px;letter-spacing:0.04em;word-break:break-all;margin:0 0 32px;">${inviteUrl}</p>
          <hr style="border:none;border-top:1px solid #1a1a1a;margin:0 0 24px;">
          <p style="color:#444;font-size:9px;letter-spacing:0.12em;line-height:1.8;margin:0;text-transform:uppercase;">
            This invite was sent by ${adminName || 'your firm admin'} · The Brokers Terminal<br>
            If you weren't expecting this, you can ignore this email.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  });

  const result = await new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        console.log('Resend status:', res.statusCode, data);
        resolve({ status: res.statusCode, body: data });
      });
    });

    req.on('error', (err) => {
      console.error('HTTPS request error:', err.message);
      resolve({ status: 0, body: err.message });
    });

    req.write(payload);
    req.end();
  });

  if (result.status !== 200 && result.status !== 201) {
    return { statusCode: 500, body: 'Resend error ' + result.status + ': ' + result.body };
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
