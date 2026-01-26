const { chromium } = require('playwright');
const fs = require('fs-extra');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, 'archive');
//const GRYFFS_JSON = path.join(OUTPUT_DIR, 'gryffs.json');

// DOWNLOADER
async function downloadImage(page, url, outputPath) {
    const response = await page.request.get(url);
    if (!response.ok()) {
        throw new Error(`Failed to download ${url}`);
    }
    const buffer = await response.body();
    await fs.writeFile(outputPath, buffer);
}

(async () => {
    console.log('GRYFFS ARCHIVER IS STARTING, PLEASE WAIT...');

    // Verify output directory exists
    fs.ensureDirSync(OUTPUT_DIR);

    // Launch browser
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    // Go to login page
    await page.goto('https://gryffs.com/');
    console.log('Please log in to your Gryffs account in the opened browser. Do not attempt to use a different browser, as this terminal will not have access to it.');
    console.log('Once you are logged in, press ENTER here to continue.');
    await new Promise(resolve => process.stdin.once('data', resolve));

    // Determine your user ID
    const userId = await page.$eval(
        '.profileArea .inner a[href*="profile.php?id="]',
        (link) => {
            const match = link.href.match(/id=(\d+)/);
            return match ? match[1] : null;
        }
    );

    if (!userId) {
    throw new Error('Error extracting user ID... cannot proceed.');
    }

    console.log(`Logged in as user ID: ${userId}`);

    // Get all Gryff IDs
    console.log('Fetching list of gryffs...');
    await page.goto(`https://gryffs.com/ghf.php?id=${userId}&box=-1`);

    const gryffs = await page.$$eval(
        '#ghfList .ghfGryff a[href*="gryff.php?id="]',
        (links) => {
            return links.map(link => {
            const match = link.href.match(/id=(\d+)/);
            return match
                ? {
                    id: match[1],
                    url: link.href
                }
                : null;
            }).filter(Boolean);
        }
    );

    console.log(`Found ${gryffs.length} gryffs!`);

    // TEMP HARDCODE ID, NO LOOP YET
    const gryff = {id: "5193", url: "https://gryffs.com/gryff.php?id=5193"};
    await page.goto(gryff.url);

    const gryffDir = path.join(OUTPUT_DIR, 'gryffs', gryff.id);
    await fs.ensureDir(gryffDir);

    // NAME
    const rawName = await page.$eval(
        'h1.page-title',
        el => el.innerText.trim()
    );

    // "Gryff - Name" -> "Name"
    const name = rawName.replace(/^Gryff\s*-\s*/i, '');

    // SPECIES, LEVEL, EXP
    const separatorText = await page.$eval(
        'div.pageSeparator',
        el => el.innerText
    );

    const sepMatch = separatorText.match(/^(.+?)\s+Gryff\s+Level\s+(\d+)\s+\((\d+)\s+exp\)/i);

    if (!sepMatch) {
        throw new Error(`Could not parse pageSeparator: ${separatorText}`);
    }

    const species = sepMatch[1].trim();
    const level = parseInt(sepMatch[2], 10);
    const exp = parseInt(sepMatch[3], 10);

    // WINS / LOSSES
    const statsText = await page.$$eval(
    'div',
    divs => divs
        .map(d => d.innerText.trim())
        .find(t => /\d+\s+Wins\s*\/\s*\d+\s+Losses/i.test(t))
    );

    if (!statsText) {
        throw new Error('Wins/Losses block not found');
    }

    const statsMatch = statsText.match(/(\d+)\s+Wins\s*\/\s*(\d+)\s+Losses/i);

    const wins = parseInt(statsMatch[1], 10);
    const losses = parseInt(statsMatch[2], 10);
    const totalBattles = wins + losses;

    // HUNTING EXP
    const huntingText = await page.$$eval(
        'div',
        divs => divs
            .map(d => d.innerText.trim())
            .find(t => /\d+\s+Hunting\s+Exp/i.test(t))
        );

        if (!huntingText) {
            throw new Error('Hunting Exp block not found');
        }

        const huntingExp = parseInt(
        huntingText.match(/(\d+)\s+Hunting\s+Exp/i)[1],
        10
    );

    // DESCRIPTION
    let descriptionHtml = await page.$eval(
        '#gryffsDesc',
        el => el.innerHTML
    );

    // IMAGES
    const prefix = Math.floor(parseInt(gryff.id, 10) / 1000);
    const mainImageUrl = `https://gryffs.com/static/gryffs/${prefix}/${gryff.id}.png`;
    const thumbUrl = `https://gryffs.com/static/gryffs/thumbs/${prefix}/${gryff.id}.png`;

    // DOWNLOAD IMAGE AND THUMBNAIL
    await downloadImage(
        page,
        mainImageUrl,
        path.join(gryffDir, 'image.png')
    );

    await fs.ensureDir(path.join(OUTPUT_DIR, 'thumbs'));

    await downloadImage(
        page,
        thumbUrl,
        path.join(OUTPUT_DIR, 'thumbs', `${gryff.id}.png`)
    );

    // DOWNLOAD DESC IMAGES
    const descImageUrls = await page.$$eval(
        '#gryffsDesc img',
        imgs => imgs.map(img => img.src)
    );

    let descIndex = 1;

    for (const imgUrl of descImageUrls) {
        const ext = path.extname(new URL(imgUrl).pathname) || '.png';
        const localName = `desc_${descIndex}${ext}`;
        const localPath = path.join(gryffDir, localName);

        try {
            await downloadImage(page, imgUrl, localPath);

            // Rewrite HTML to local path
            descriptionHtml = descriptionHtml.replaceAll(
            imgUrl,
            `./${localName}`
            );

            descIndex++;
        } catch (err) {
            console.warn(`Failed desc image: ${imgUrl}`);
        }
    }

    // WRITE INFO FILE
    const info = {
        id: gryff.id,
        name,
        species,
        level,
        exp,
        wins,
        losses,
        totalBattles,
        huntingExp,
        descriptionHtml,
        sourceUrl: gryff.url
    };

    await fs.writeJson(
        path.join(gryffDir, 'info.json'),
        info,
        { spaces: 2 }
    );

})();
