const apiKey = process.env.BREVO_API_KEY;

console.log('Testing new sender: noreply@seerticks.com');

async function sendTestEmail() {
  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender: { name: 'SEER AI Trading', email: 'noreply@seerticks.com' },
        to: [{ email: 'rdaulakh@exoways.com', name: 'RD' }],
        subject: 'SEER Test - New Sender Verified',
        htmlContent: '<h1>Test Email</h1><p>This email was sent from noreply@seerticks.com - your new verified sender!</p>',
        textContent: 'Test Email - This email was sent from noreply@seerticks.com',
      }),
    });
    
    const data = await response.json();
    
    if (response.ok) {
      console.log('✅ Email sent successfully!');
      console.log('   Message ID:', data.messageId);
    } else {
      console.error('❌ Failed:', data.message || data.code);
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

sendTestEmail();
