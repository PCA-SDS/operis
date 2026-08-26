require('dotenv').config({path:'apps/mercato/.env'});
const { Client } = require('pg');
const c = new Client({connectionString: process.env.DATABASE_URL});
const TENANT = '97bec69b-5881-4012-8462-7c32e96ada9e';

async function main() {
  await c.connect();
  const r = await c.query(
    "SELECT id, title FROM catalog_products WHERE tenant_id=$1 AND title ILIKE $2 ORDER BY title",
    [TENANT, '%nail extension%']
  );
  console.log('=== Nail Extensions Products ===');
  r.rows.forEach(row => {
    console.log(`${row.title}`);
    console.log(`  Options: http://localhost:3000/backend/catalog/products/${row.id}/options`);
    console.log(`  Edit:    http://localhost:3000/backend/catalog/products/${row.id}`);
  });
  await c.end();
}
main().catch(e => { console.error(e.message); process.exit(1) });
