import { supabase } from './supabase.js';

async function testConnection() {
  console.log('Testing Supabase connection...\n');

  const { data, error } = await supabase
    .from('platforms')
    .select('*');

  if (error) {
    console.error('Connection failed:', error.message);
    process.exit(1);
  }

  console.log(`Connected! Found ${data.length} platforms:\n`);
  for (const platform of data) {
    console.log(`  - ${platform.name} (${platform.base_url})`);
    console.log(`    Scan interval: ${platform.scan_interval_min} min`);
    console.log(`    Active: ${platform.is_active}`);
    console.log();
  }

  console.log('Supabase is wired up and ready.');
}

testConnection();
