// Test Brevo API key and email sending
const apiKey = process.env.BREVO_API_KEY;

console.log('Testing Brevo API...');
console.log('API Key prefix:', apiKey ? apiKey.substring(0, 15) + '...' : 'NOT SET');

if (!apiKey) {
  console.error('ERROR: BREVO_API_KEY not set');
  process.exit(1);
}

// Test 1: Validate API key
async function validateApiKey() {
  console.log('\n1. Validating API key...');
  try {
    const response = await fetch('https://api.brevo.com/v3/account', {
      method: 'GET',
      headers: {
        'accept': 'application/json',
        'api-key': apiKey,
      },
    });
    
    const data = await response.json();
    
    if (response.ok) {
      console.log('✅ API key is valid');
      console.log('   Account email:', data.email);
      console.log('   Company:', data.companyName);
      return true;
    } else {
      console.error('❌ API key validation failed:', data.message || data.code);
      return false;
    }
  } catch (error) {
    console.error('❌ Error validating API key:', error.message);
    return false;
  }
}

// Test 2: Check sender domains
async function checkSenders() {
  console.log('\n2. Checking authorized senders...');
  try {
    const response = await fetch('https://api.brevo.com/v3/senders', {
      method: 'GET',
      headers: {
        'accept': 'application/json',
        'api-key': apiKey,
      },
    });
    
    const data = await response.json();
    
    if (response.ok) {
      console.log('✅ Senders retrieved');
      if (data.senders && data.senders.length > 0) {
        data.senders.forEach(sender => {
          console.log(`   - ${sender.name} <${sender.email}> (active: ${sender.active})`);
        });
      } else {
        console.log('   ⚠️ No senders configured - this might be the issue!');
      }
      return data.senders;
    } else {
      console.error('❌ Failed to get senders:', data.message);
      return [];
    }
  } catch (error) {
    console.error('❌ Error getting senders:', error.message);
    return [];
  }
}

// Test 3: Send a test email
async function sendTestEmail(senderEmail) {
  console.log('\n3. Sending test email...');
  
  const sender = {
    name: 'SEER AI Trading',
    email: senderEmail || 'noreply@seerticks.com'
  };
  
  console.log('   Using sender:', sender.email);
  
  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender: sender,
        to: [{ email: 'rdaulakh@exoways.com', name: 'RD' }],
        subject: 'SEER Test Email - Brevo Integration',
        htmlContent: '<h1>Test Email</h1><p>This is a test email from SEER to verify Brevo integration is working.</p>',
        textContent: 'Test Email - This is a test email from SEER to verify Brevo integration is working.',
      }),
    });
    
    const data = await response.json();
    
    if (response.ok) {
      console.log('✅ Test email sent successfully!');
      console.log('   Message ID:', data.messageId);
      return true;
    } else {
      console.error('❌ Failed to send email:', data.message || data.code);
      console.error('   Full response:', JSON.stringify(data, null, 2));
      return false;
    }
  } catch (error) {
    console.error('❌ Error sending email:', error.message);
    return false;
  }
}

// Run tests
async function main() {
  const isValid = await validateApiKey();
  if (!isValid) {
    console.log('\n⚠️ Cannot proceed - API key is invalid');
    return;
  }
  
  const senders = await checkSenders();
  
  // Use the first active sender if available
  let senderEmail = null;
  if (senders && senders.length > 0) {
    const activeSender = senders.find(s => s.active);
    if (activeSender) {
      senderEmail = activeSender.email;
    }
  }
  
  await sendTestEmail(senderEmail);
  
  console.log('\n=== Summary ===');
  console.log('If emails are not being received:');
  console.log('1. Check if the sender email domain is verified in Brevo');
  console.log('2. Check Brevo dashboard for any blocked/bounced emails');
  console.log('3. Check spam folder');
}

main();
