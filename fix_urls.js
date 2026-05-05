const fs = require('fs');
const path = require('path');

function fixFile(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Replace 'http://127.0.0.1:3000/path' with `${API_URL}/path`
    content = content.replace(/['"]http:\/\/127\.0\.0\.1:3000([^'"]*)['"]/g, '`${API_URL}$1`');
    content = content.replace(/['"]http:\/\/localhost:3000([^'"]*)['"]/g, '`${API_URL}$1`');

    // Replace the raw socket io('http://127.0.0.1:3000') correctly if it was messed up
    // In our case io(API_URL) is correct.
    
    fs.writeFileSync(filePath, content);
    console.log(`Fixed ${filePath}`);
}

function walk(dir) {
    const list = fs.readdirSync(dir);
    for (let file of list) {
        file = path.join(dir, file);
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory()) {
            if (!file.includes('node_modules')) walk(file);
        } else {
            if (file.endsWith('.jsx') || file.endsWith('.js')) fixFile(file);
        }
    }
}

walk('rescue-frontend/src');
walk('rescue-web-admin/src');
