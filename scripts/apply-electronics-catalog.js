// Explicit content update only. Existing routes, schema and business services are unchanged.
require('../config/environment');
const fs = require('node:fs/promises');
const path = require('node:path');
const {getPool,closePool} = require('../config/db');
const catalog = require('../data/electronics-catalog.json');
async function applyCatalog({onlyAdditions=false}={}) {
  const pool=getPool(), connection=await pool.getConnection();
  try {
    const backupDir=path.join(__dirname,'../.local/catalog-backups');
    await fs.mkdir(backupDir,{recursive:true});
    const [products]=await connection.query('SELECT * FROM products');
    const [categories]=await connection.query('SELECT * FROM categories');
    const backup=path.join(backupDir,`before-electronics-${Date.now()}.json`);
    await fs.writeFile(backup,JSON.stringify({products,categories},null,2));
    await connection.beginTransaction();
    if(!onlyAdditions)for (const c of catalog.categories) await connection.execute('UPDATE categories SET name=?,sort_order=? WHERE slug=?',[c.name,c.order,c.slug]);
    let inserted=0;
    for (const p of catalog.products) {
      if(onlyAdditions && p.previousSku)continue;
      await fs.access(path.join(__dirname,'../public/images',p.image));
      const [[category]]=await connection.execute('SELECT id FROM categories WHERE slug=?',[p.category]);
      const [rows]=await connection.execute('SELECT id,sku FROM products WHERE sku IN (?,?) AND is_demo=1 FOR UPDATE',[p.previousSku||p.sku,p.sku]);
      if(!category || rows.length>1 || (p.previousSku && rows.length!==1))throw Error(`Expected one demo product for ${p.sku}; aborting content update.`);
      if(!p.previousSku){
        if(!rows.length){
          await connection.execute('INSERT INTO products(sku,name,description,price,stock,image_path,category_id,color,tag,is_demo) VALUES(?,?,?,?,?,?,?,?,?,1)',
            [p.sku,p.name,p.description,p.price,p.stock,'/images/'+p.image,category.id,p.color,p.tag]);inserted++;
        }
        continue;
      }
      // Preserve product identity, current stock, cart/favorite associations, and immutable order snapshots.
      await connection.execute('UPDATE products SET sku=?,name=?,description=?,price=?,image_path=?,category_id=?,color=?,tag=? WHERE id=? AND is_demo=1',
        [p.sku,p.name,p.description,p.price,'/images/'+p.image,category.id,p.color,p.tag,rows[0].id]);
    }
    await connection.commit();console.log(`Catalog applied; inserted ${inserted} products. Existing stock preserved. Backup:`,path.relative(path.join(__dirname,'..'),backup));
  } catch(error) {await connection.rollback();throw error;} finally {connection.release();}
}
if(require.main===module)applyCatalog().catch(error=>{console.error(error.message);process.exitCode=1}).finally(closePool);
module.exports={applyCatalog};
