// Run after opening the target origin with playwright-cli in a named session:
// playwright-cli -s=check run-code --filename=scripts/check-safari-swipe.mjs
// Chromium uses trusted touch input; WebKit uses a TouchEvent-shaped replay.
async (page) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const origin = await page.evaluate(() => location.origin);
  await page.goto(`${origin}/?check=swipe-layers`);
  await page.waitForSelector(".link-card");
  await page.locator(".link-card").first().click();
  await page.waitForSelector("#note-back-edge");
  const idle = () => page.waitForFunction(() => !document.getElementById("note-detail-sheet").closest(".taro_page").getAnimations().length);
  await idle();
  const engine = page.context().browser().browserType().name();
  const cdp = engine === "chromium" ? await page.context().newCDPSession(page) : null;
  if (cdp) await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true });
  const send = async (type, x) => {
    if (cdp) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: { touchstart: "touchStart", touchmove: "touchMove", touchend: "touchEnd" }[type],
        touchPoints: type === "touchend" ? [] : [{ x, y: 250, id: 1 }],
      });
    } else {
      await page.evaluate(({ type, x }) => {
        const edge = document.getElementById("note-back-edge");
        const touch = { identifier: 1, target: edge, clientX: x, clientY: 250 };
        const event = document.createEvent("Event"); event.initEvent(type, true, true);
        Object.defineProperties(event, { touches: { value: type === "touchend" ? [] : [touch] }, changedTouches: { value: [touch] } });
        edge.dispatchEvent(event);
      }, { type, x });
    }
  };
  const assertHeld = async (expectedX) => {
    const state = await page.evaluate(() => {
      const sheet = document.getElementById("note-detail-sheet"), rect = sheet.getBoundingClientRect();
      return { x: rect.x, y: rect.y, detailVisible: !!document.elementFromPoint(Math.min(rect.x + 40, 380), 250)?.closest("#note-detail-sheet"), onDetail: location.hash.includes("inspiration-detail") };
    });
    if (Math.abs(state.x - expectedX) > 2 || Math.abs(state.y) > 2 || !state.detailVisible || !state.onDetail) throw new Error(`Detail disappeared during drag: ${JSON.stringify(state)}`);
    return state;
  };
  await send("touchstart", 8); await send("touchmove", 58); await assertHeld(50);
  await send("touchmove", 108); const held = await assertHeld(100);
  await page.screenshot({ path: `/tmp/bear-swipe-layers-${engine}.png` });
  // Stationary hold checks distance-based release instead of fast-flick dismissal.
  await page.waitForTimeout(150); await assertHeld(100);
  await send("touchend", 108); await idle(); await assertHeld(0);
  await send("touchstart", 8); await send("touchmove", 108); await send("touchmove", 218);
  await page.waitForTimeout(150); await assertHeld(210);
  await send("touchend", 218);
  await page.waitForURL("**/pages/inspiration/index"); await page.waitForSelector(".link-card");
  await page.waitForFunction(() => !document.querySelector(".note-back-underlay, .note-back-foreground, .taro_page[inert]"));
  const clean = await page.evaluate(() => !document.querySelector(".note-back-underlay, .note-back-foreground, .taro_page[inert]"));
  if (!clean) throw new Error("Gesture left the list layered or inert after returning");
  return { engine, held, shortDragCancelled: true, returnedOnlyAfterRelease: true, clean };
}
