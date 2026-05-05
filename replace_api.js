const fs = require('fs');
const path = require('path');

const API_URL_IMPORT = `import { API_URL } from './config';\n`;

function replaceInFile(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');
    if (content.includes('http://127.0.0.1:3000') || content.includes('http://localhost:3000')) {
        content = content.replace(/['"`]http:\/\/127\.0\.0\.1:3000['"`]/g, 'API_URL');
        content = content.replace(/['"`]http:\/\/localhost:3000['"`]/g, 'API_URL');
        
        // Add import after the last import statement or at top
        if (!content.includes('import { API_URL }')) {
            const lines = content.split('\n');
            let lastImportIdx = -1;
            for(let i=0; i<lines.length; i++) {
                if (lines[i].startsWith('import ')) lastImportIdx = i;
            }
            if (lastImportIdx >= 0) {
                lines.splice(lastImportIdx + 1, 0, API_URL_IMPORT);
            } else {
                lines.unshift(API_URL_IMPORT);
            }
            content = lines.join('\n');
        }
        
        // Handle template literals: `http://127.0.0.1:3000/api...` -> `${API_URL}/api...`
        content = content.replace(/`http:\/\/127\.0\.0\.1:3000([^`]*)`/g, '`${API_URL}$1`');
        content = content.replace(/`http:\/\/localhost:3000([^`]*)`/g, '`${API_URL}$1`');

        fs.writeFileSync(filePath, content);
        console.log(`Updated ${filePath}`);
    }
}

function walk(dir) {
    const list = fs.readdirSync(dir);
    for (let file of list) {
        file = path.join(dir, file);
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory()) {
            if (!file.includes('node_modules')) walk(file);
        } else {
            if (file.endsWith('.jsx') || file.endsWith('.js')) replaceInFile(file);
        }
    }
}

// Create config.js
const configContent = `export const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:3000';\n`;
fs.writeFileSync('rescue-frontend/src/config.js', configContent);
fs.writeFileSync('rescue-web-admin/src/config.js', configContent);

walk('rescue-frontend/src');
walk('rescue-web-admin/src');
