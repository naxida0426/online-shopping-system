require('../config/environment');
const{applyCatalog}=require('./apply-electronics-catalog');
const{closePool}=require('../config/db');
applyCatalog({onlyAdditions:true}).catch(error=>{console.error(error.message);process.exitCode=1}).finally(closePool);
