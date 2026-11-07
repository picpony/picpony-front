"""Editor menus, dialog commands, selection and motion on real production routes."""
import io
import json
import pathlib
import sys
import traceback
from playwright.sync_api import sync_playwright, expect
from PIL import Image
from browserLaunch import browser_options
from testProfileGallery import BASE, Fixtures, USER

OUTPUT = pathlib.Path(__file__).resolve().parent.parent / '.workbuddy' / 'editor-panels'
OUTPUT.mkdir(parents=True, exist_ok=True)
RESULTS = []
FAILURES = []

MOTION_RECORDER = """(() => {
  window.__editorMotion = [];
  const animate = Element.prototype.animate;
  Element.prototype.animate = function(frames, options) {
    const animation = animate.call(this, frames, options);
    if (this.matches('[role=dialog], [role=menu]')) {
      window.__editorMotion.push({role:this.getAttribute('role'),
        label:this.getAttribute('aria-label') || document.getElementById(this.getAttribute('aria-labelledby'))?.textContent,
        frames, duration: typeof options === 'number' ? options : options?.duration});
    }
    return animation;
  };
})()"""


def settle(panel):
    panel.evaluate('(el)=>Promise.allSettled(el.getAnimations({subtree:true}).map(a=>a.finished))')


def open_color(page, editor, name='文字颜色'):
    if not editor.get_by_role('button', name=name, exact=True).count():
        editor.get_by_role('button', name='更多格式', exact=True).click()
    editor.get_by_role('button', name=name, exact=True).click()
    panel = page.get_by_role('dialog', name=name, exact=True)
    expect(panel).to_be_visible()
    return panel


def run(browser, name, width, scheme, motion):
    context = browser.new_context(viewport={'width':width, 'height':900}, color_scheme=scheme,
                                  reduced_motion='reduce' if motion == 'reduced' else 'no-preference',
                                  is_mobile=width < 500, has_touch=width < 500)
    context.route('**/*', Fixtures())
    stored = {'user_info':json.dumps(USER), 'picpony_motion':motion,
              'picpony_dev_banner_dismissed':'true', 'trixie_use_cdn':'false',
              'picpony_use_proxy':'false', 'picpony_hk_relay':'false'}
    context.add_init_script('for(const [k,v] of Object.entries('+json.dumps(stored)+'))localStorage.setItem(k,v)')
    context.add_init_script(MOTION_RECORDER)
    page = context.new_page()
    page.set_default_timeout(10000)
    errors = []
    writes = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('request', lambda request: writes.append(request.url)
            if request.method not in ('GET', 'HEAD', 'OPTIONS') and '/forum/posts' in request.url else None)
    try:
        page.goto(BASE+'/forum/create', wait_until='networkidle')
        editor = page.locator('.rich-text-editor:not([aria-hidden])')
        text = editor.locator('[data-slate-editor]')
        expect(text).to_be_visible()
        text.click()
        more = editor.get_by_role('button', name='更多格式', exact=True)
        if not editor.get_by_role('button', name='重做', exact=True).count():
            more.click()
        undo = editor.get_by_role('button', name='撤销', exact=True)
        redo = editor.get_by_role('button', name='重做', exact=True)
        for command in [undo, redo]:
            expect(command).to_be_disabled()
            box = command.bounding_box()
            point = (box['x']+box['width']/2, box['y']+box['height']/2)
            if width < 500:
                page.touchscreen.tap(*point)
            else:
                page.mouse.click(*point)
            expect(text).to_be_focused()
        text.fill('小马的友谊故事')
        text.press('End')
        expect(undo).to_be_enabled()
        undo.click()
        expect(text).to_have_text('')
        expect(text).to_be_focused()
        expect(undo).to_be_disabled()
        expect(redo).to_be_enabled()
        redo.click()
        expect(text).to_have_text('小马的友谊故事')
        expect(text).to_be_focused()
        expect(redo).to_be_disabled()
        settle(editor)
        focused_ink = editor.evaluate('el=>getComputedStyle(el).outlineColor')
        image = editor.get_by_role('button', name='插入图片', exact=True)
        expect(image).to_have_attribute('aria-disabled', 'false')
        menu = page.get_by_role('menu', name='插入图片', exact=True)

        if width >= 500:
            title = page.get_by_role('textbox', name='标题', exact=False)
            title.focus()
            image.hover()
            page.wait_for_timeout(150)
            expect(page.get_by_role('menu', name='插入图片', exact=True)).to_have_count(0)
            expect(title).to_be_focused()
            text.click()
            text.press('End')
            expect(image).to_have_attribute('aria-disabled', 'false')
            image.hover()
            page.wait_for_timeout(150)
            expect(menu).to_have_count(0)
            expect(text).to_be_focused()
            image.click()
        else:
            image.tap()
        expect(menu).to_be_visible()
        settle(menu)
        settle(editor)
        assert editor.evaluate('el=>getComputedStyle(el).outlineColor') == focused_ink
        expect(menu.get_by_role('menuitem', name='上传图片', exact=True)).to_be_focused()
        if width >= 500:
            page.mouse.move(8, 80)
            expect(menu).to_be_visible()
            image.click()
            expect(menu).not_to_be_visible()
            image.hover()
            page.wait_for_timeout(150)
            expect(menu).not_to_be_visible()
            image.focus()
            image.press('ArrowDown')
            expect(menu).to_be_visible()
            page.keyboard.press('Escape')
            expect(menu).not_to_be_visible()
            expect(image).to_be_focused()
            text.click()
            text.press('End')
            expect(image).to_have_attribute('aria-disabled', 'false')
            image.click()
            expect(menu).to_be_visible()
            settle(menu)
            option = menu.get_by_role('menuitem', name='网络图片', exact=True)
            box = option.bounding_box()
            page.mouse.move(box['x']+box['width']/2, box['y']+box['height']/2, steps=12)
            expect(menu).to_be_visible()
            page.mouse.move(8, 80)
            expect(menu).to_be_visible()
            page.keyboard.press('Home')
            expect(menu.get_by_role('menuitem', name='上传图片', exact=True)).to_be_focused()
            page.keyboard.press('ArrowDown')
            expect(menu.get_by_role('menuitem', name='网络图片', exact=True)).to_be_focused()
        else:
            image.tap()
            expect(menu).not_to_be_visible()
            image.tap()
            expect(menu).to_be_visible()
            settle(menu)
        menu.screenshot(path=str(OUTPUT/(name+'-image-menu.png')))
        menu.get_by_role('menuitem', name='网络图片', exact=True).click()
        image_dialog = page.get_by_role('dialog', name='网络图片', exact=True)
        expect(image_dialog).to_be_visible()
        settle(image_dialog)
        settle(editor)
        assert editor.evaluate('el=>getComputedStyle(el).outlineColor') == focused_ink
        expect(image_dialog.get_by_label('图片地址', exact=False)).to_be_focused()
        image_dialog.screenshot(path=str(OUTPUT/(name+'-image-dialog.png')))
        page.keyboard.press('Escape')
        expect(image_dialog).not_to_be_visible()
        expect(text).to_have_text('小马的友谊故事')
        expect(text).to_be_focused()

        text.click()
        text.press('ControlOrMeta+A')
        text.press('ControlOrMeta+k')
        link = page.get_by_role('dialog', name='插入链接', exact=True)
        expect(link).to_be_visible()
        settle(link)
        settle(editor)
        assert editor.evaluate('el=>getComputedStyle(el).outlineColor') == focused_ink
        field = link.get_by_label('链接文本', exact=False)
        expect(field).to_have_value('小马的友谊故事')
        link.get_by_role('button', name='插入', exact=True).click()
        expect(link.get_by_text('请输入链接地址', exact=True)).to_be_visible()
        link.get_by_label('链接地址', exact=False).fill('javascript:alert(1)')
        link.get_by_role('button', name='插入', exact=True).click()
        expect(link.get_by_text('请输入有效的链接地址', exact=True)).to_be_visible()
        field.fill('小马社区')
        link.get_by_label('链接地址', exact=False).fill('https://example.test/pony')
        settle(link)
        link.screenshot(path=str(OUTPUT/(name+'-link-dialog.png')))
        for _ in range(8):
            page.keyboard.press('Tab')
            assert link.evaluate('el=>el.contains(document.activeElement)'), 'Dialog focus escaped'
        link.get_by_role('button', name='插入', exact=True).click()
        expect(link).not_to_be_visible()
        expect(text.locator('a')).to_have_text('小马社区')
        expect(text.locator('a')).to_have_attribute('href', 'https://example.test/pony')

        text.locator('a').click()
        context_menu = page.get_by_role('menu', name='链接操作', exact=True)
        expect(context_menu).to_be_visible()
        context_menu.get_by_role('menuitem', name='修改链接', exact=True).click()
        edit = page.get_by_role('dialog', name='修改链接', exact=True)
        expect(edit).to_be_visible()
        edit.get_by_label('链接地址', exact=False).fill('https://example.test/updated')
        edit.get_by_role('button', name='保存', exact=True).click()
        expect(text.locator('a')).to_have_attribute('href', 'https://example.test/updated')

        text.click()
        text.press('ControlOrMeta+A')
        page.evaluate('window.__editorMotion=[]')
        color = open_color(page, editor)
        settle(color)
        if motion == 'standard':
            turn = editor.get_by_role('button', name='文字颜色', exact=True).evaluate("""async button => {
              const panel = document.querySelector('[role=dialog][aria-label="文字颜色"]');
              button.click();
              await new Promise(requestAnimationFrame);
              const leaving = panel.inert;
              button.click();
              await new Promise(requestAnimationFrame);
              return {leaving, same:panel===document.querySelector('[role=dialog][aria-label="文字颜色"]'), open:!panel.inert};
            }""")
            assert turn['leaving'] and turn['same'] and turn['open'], turn
            settle(color)
        color.screenshot(path=str(OUTPUT/(name+'-color-panel.png')))
        color.get_by_role('button', name='选择颜色 #000000', exact=True).focus()
        page.keyboard.press('ArrowRight')
        assert page.evaluate('document.activeElement.getAttribute("aria-label")') != '选择颜色 #000000'
        page.keyboard.press('Home')
        page.keyboard.press('Enter')
        expect(color).not_to_be_visible()
        expect(text.locator('span[style*="color"]')).not_to_have_count(0)
        tracks = page.evaluate('window.__editorMotion.filter(a=>a.label==="文字颜色")')
        if motion == 'standard':
            assert any('transform' in frame for track in tracks for frame in track['frames']), tracks
            assert any(frame.get('opacity') == '0' for track in tracks for frame in track['frames']), tracks
        elif motion == 'reduced':
            assert tracks and all('transform' not in frame for track in tracks for frame in track['frames']), tracks
        else:
            assert not tracks, tracks
        color = open_color(page, editor)
        color.get_by_role('button', name='默认文字颜色', exact=True).click()
        expect(color).not_to_be_visible()
        expect(text.locator('span[style*="color"]')).to_have_count(0)

        more = editor.get_by_role('button', name='更多格式', exact=True)
        if more.count() and more.get_attribute('aria-expanded') != 'true':
            more.click()
        text.press('ControlOrMeta+End')
        text.press('Enter')
        editor.get_by_role('button', name='插入表格', exact=True).click()
        table = page.get_by_role('dialog', name='插入表格', exact=True)
        expect(table).to_be_visible()
        settle(table)
        settle(editor)
        assert editor.evaluate('el=>getComputedStyle(el).outlineColor') == focused_ink
        table.screenshot(path=str(OUTPUT/(name+'-table-dialog.png')))
        table.get_by_role('button', name='取消', exact=True).click()
        expect(table).not_to_be_visible()
        expect(text).to_be_focused()
        editor.get_by_role('button', name='插入表格', exact=True).click()
        expect(table).to_be_visible()
        table.get_by_label('行数', exact=False).fill('0')
        table.get_by_role('button', name='插入', exact=True).click()
        expect(table.get_by_text('请输入 1 至 10 的整数', exact=True)).to_be_visible()
        table.get_by_label('行数', exact=False).fill('2')
        table.get_by_label('列数', exact=False).fill('3')
        table.get_by_role('button', name='插入', exact=True).click()
        expect(text.locator('table tr')).to_have_count(2)
        expect(text.locator('table tr').first.locator('th,td')).to_have_count(3)
        assert text.evaluate("el=>Boolean(el.querySelector('a').compareDocumentPosition(el.querySelector('table')) & Node.DOCUMENT_POSITION_FOLLOWING)"), 'Table was inserted before the saved editing position'
        text.locator('table tr').first.locator('th,td').first.click()
        table_actions = page.get_by_role('menu', name='表格操作', exact=True)
        expect(table_actions).to_be_visible()
        table_actions.get_by_role('menuitem', name='插入行', exact=True).click()
        expect(text.locator('table tr')).to_have_count(3)
        text.locator('table tr').first.locator('th,td').first.click()
        expect(table_actions).to_be_visible()
        settle(table_actions)
        editor.screenshot(path=str(OUTPUT/(name+'-editor.png')))

        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        assert not writes, writes
        assert not errors, errors
        RESULTS.append({'profile':name, 'passed':True, 'colorMotionTracks':len(tracks)})
        print('PASS '+name, flush=True)
    except Exception as error:
        FAILURES.append({'profile':name, 'error':str(error), 'pageErrors':errors,
                         'traceback':traceback.format_exc(),
                         'focus':page.evaluate('document.activeElement?.outerHTML')})
        print('FAIL '+name+' '+traceback.format_exc(), flush=True)
        try:
            page.screenshot(path=str(OUTPUT/(name+'-failure.png')), timeout=3000)
        except Exception:
            pass
    finally:
        context.close()


def picture_commands(browser):
    context = browser.new_context(viewport={'width':1440, 'height':900})
    context.route('**/*', Fixtures())
    stored = {'user_info':json.dumps(USER), 'picpony_motion':'off', 'picpony_dev_banner_dismissed':'true',
              'trixie_use_cdn':'false', 'picpony_use_proxy':'false', 'picpony_hk_relay':'false'}
    context.add_init_script('for(const [k,v] of Object.entries('+json.dumps(stored)+'))localStorage.setItem(k,v)')
    buffer = io.BytesIO()
    Image.new('RGB', (120, 80), '#a3b9ce').save(buffer, 'PNG')
    address = 'https://example.test/editor-image.png'
    context.route(address, lambda route: route.fulfill(status=200, content_type='image/png', body=buffer.getvalue()))
    page = context.new_page()
    page.set_default_timeout(10000)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    try:
        page.goto(BASE+'/forum/create', wait_until='networkidle')
        editor = page.locator('.rich-text-editor:not([aria-hidden])')
        text = editor.locator('[data-slate-editor]')
        text.fill('图片说明')
        text.press('End')
        trigger = editor.get_by_role('button', name='插入图片', exact=True)
        expect(trigger).to_have_attribute('aria-disabled', 'false')
        trigger.click()
        menu = page.get_by_role('menu', name='插入图片', exact=True)
        with page.expect_file_chooser() as chosen:
            menu.get_by_role('menuitem', name='上传图片', exact=True).click()
        chosen.value.set_files([])
        expect(menu).not_to_be_visible()
        text.click()
        trigger.click()
        menu.get_by_role('menuitem', name='网络图片', exact=True).click()
        dialog = page.get_by_role('dialog', name='网络图片', exact=True)
        dialog.get_by_label('图片地址', exact=False).fill(address)
        dialog.get_by_label('图片描述', exact=False).fill('图片预览')
        dialog.get_by_role('button', name='插入', exact=True).click()
        image = text.locator('img')
        expect(image).to_have_attribute('src', address)
        expect(image).to_have_attribute('alt', '图片预览')
        page.wait_for_function('(address)=>{const img=document.querySelector(`[data-slate-editor] img`);return img?.src===address&&img.complete&&img.naturalWidth>0}', arg=address)
        image.click()
        actions = page.get_by_role('menu', name='图片操作', exact=True)
        expect(actions).to_be_visible()
        actions.get_by_role('menuitem', name='删除图片', exact=True).click()
        expect(image).to_have_count(0)
        assert not errors, errors
        RESULTS.append({'profile':'image-commands', 'passed':True})
        print('PASS image-commands', flush=True)
    except Exception as error:
        FAILURES.append({'profile':'image-commands', 'error':str(error), 'pageErrors':errors})
        print('FAIL image-commands '+str(error), flush=True)
    finally:
        context.close()


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(**browser_options(), headless=True)
    profiles = [('desktop',1440,'light','standard'), ('mobile-dark',390,'dark','standard'),
                ('reduced',1440,'light','reduced'), ('off',390,'light','off')]
    if '--quick' in sys.argv:
        profiles = profiles[:1]
    if '--images-only' in sys.argv:
        profiles = []
    for profile in profiles:
        run(browser, *profile)
    if '--quick' not in sys.argv:
        picture_commands(browser)
    browser.close()
(OUTPUT/'results.json').write_text(json.dumps({'results':RESULTS,'failures':FAILURES}, ensure_ascii=False, indent=2), encoding='utf-8')
print(f'{len(RESULTS)} profiles passed, {len(FAILURES)} failed; {OUTPUT / "results.json"}', flush=True)
sys.exit(1 if FAILURES else 0)
