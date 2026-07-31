const axios = require('axios');

async function testEagles() {
  try {
    const response = await axios.get('http://localhost:3000/nfl/phi', { 
      responseType: 'text' 
    });
    
    console.log('Status:', response.status);
    if (response.data.includes('eagles')) {
      console.log('✓ Eagles found in content');
    } else {
      console.log('✗ Eagles NOT found in content');
      // Show first 2000 chars
      console.log('\nFirst 2000 chars:', response.data.substring(0, 500));
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testEagles();
