const fs = require('fs');
const path = require('path');

function build(browser) {
    const distDir = path.join(__dirname, `dist-${browser}`);

    // Creates the browser-specific target folder
    if (!fs.existsSync(distDir)) fs.mkdirSync(distDir);

    // Copy code assets into it from the src/ folder
    fs.copyFileSync('src/background.js', path.join(distDir, 'background.js'));
    //fs.copyFileSync('src/overlay.html', path.join(distDir, 'overlay.html'));
    fs.copyFileSync('src/content.js', path.join(distDir, 'content.js'));
    //fs.copyFileSync('src/overlay_helper.js', path.join(distDir, 'overlay_helper.js'));
    fs.copyFileSync('src/styles.css', path.join(distDir, 'styles.css'));
    fs.copyFileSync('src/loader.js', path.join(distDir, 'loader.js'));
    fs.copyFileSync('src/drivers.js', path.join(distDir, 'drivers.js'));


    // Update asset copying to pull from src/
    fs.copyFileSync('src/default_logo.png', path.join(distDir, 'default_logo.png'));
    fs.copyFileSync('src/active_logo.png', path.join(distDir, 'active_logo.png'));


    // Copy data mock files (Ensure casing matches exactly)
    fs.copyFileSync('sample.JSON', path.join(distDir, 'sample.json'));

    // Rename and inject the correct manifest file from the root
    fs.copyFileSync(`manifest.${browser}.json`, path.join(distDir, 'manifest.json'));

    console.log(`✓ Built target for ${browser}`);
}

build('chrome');
build('safari');
