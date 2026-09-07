import puppeteer from 'puppeteer-core';
import fs from 'fs';

if (!fs.existsSync('screenshots')) {
  fs.mkdirSync('screenshots');
}

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle', '--use-angle=swiftshader']
});

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });

const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errs.push('CONSOLE: ' + m.text());
});

await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#instructions-modal.ready', { timeout: 10000 });
await new Promise(r => setTimeout(r, 600)); // wait for fade transition

// Verify button text and hint text
const btnText = await page.$eval('#play-button', el => el.innerText.replace(/\s+/g, ' ').trim());
const hintText = await page.$eval('.play-action-hint', el => el.innerText.trim());
console.log('PLAY BUTTON TEXT:', btnText);
console.log('PLAY ACTION HINT:', hintText);

await page.screenshot({ path: 'screenshots/homepage_menu.png' });
console.log('Captured screenshots/homepage_menu.png');

// Test 1: Click #play-button (Must NOT start the game)
console.log('Testing: Click #play-button (must NOT start the game)...');
await page.click('#play-button');
await new Promise(r => setTimeout(r, 200));

const modalAfterClick = await page.$eval('#instructions-modal', el => el.style.display);
const isRunningAfterClick = await page.evaluate(() => window.__spidey?.isRunning);
const hasShakeClass = await page.$eval('#play-button', el => el.classList.contains('enter-shake'));
console.log('Modal display after click (expected visible):', modalAfterClick);
console.log('Game isRunning after click (expected false):', isRunningAfterClick);
console.log('Button has enter-shake feedback class:', hasShakeClass);

if (modalAfterClick === 'none') {
  throw new Error('Clicking should NOT hide the modal! Modal was unexpectedly hidden.');
}
if (isRunningAfterClick) {
  throw new Error('Clicking should NOT start the game! Game was unexpectedly started.');
}

// Test 2: Press Enter (MUST start the game)
console.log('Testing: Press Enter key to start game...');
await page.keyboard.press('Enter');
await new Promise(r => setTimeout(r, 200));

const modalAfterEnter = await page.$eval('#instructions-modal', el => el.style.display);
const isRunningAfterEnter = await page.evaluate(() => window.__spidey?.isRunning);
console.log('Modal display after Enter (expected "none"):', modalAfterEnter);
console.log('Game isRunning after Enter (expected true):', isRunningAfterEnter);

if (modalAfterEnter !== 'none') {
  throw new Error(`Modal did not hide on Enter press! display=${modalAfterEnter}`);
}
if (!isRunningAfterEnter) {
  throw new Error('Game did not start on Enter press!');
}

// Test 3: Press P to reopen menu, verify click does not dismiss, Enter resumes
console.log('Testing: Reopen menu with P, click does not dismiss, Enter resumes...');
await page.keyboard.press('p');
await new Promise(r => setTimeout(r, 100));
const modalAfterP = await page.$eval('#instructions-modal', el => el.style.display);
console.log('Modal display after P:', modalAfterP);

// Click inside modal
await page.click('#play-button');
await new Promise(r => setTimeout(r, 150));
const modalAfterPauseClick = await page.$eval('#instructions-modal', el => el.style.display);
if (modalAfterPauseClick === 'none') {
  throw new Error('Click unexpectedly dismissed paused menu!');
}

// Press Enter to resume
await page.keyboard.press('Enter');
await new Promise(r => setTimeout(r, 150));
const modalAfterResumeEnter = await page.$eval('#instructions-modal', el => el.style.display);
if (modalAfterResumeEnter !== 'none') {
  throw new Error('Enter key failed to resume!');
}

console.log('ALL PLAY & ENTER CHECKS PASSED!');
console.log('Errors:', errs.length ? errs : 'NONE');

await browser.close();
