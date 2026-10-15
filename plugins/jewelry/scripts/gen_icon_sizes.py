"""为 jewelry/images 下的三张透明图标生成 6 档尺寸 PNG + 多尺寸 ICO"""
from PIL import Image
import os

root = r'C:\Users\俊达\Desktop\综合业务应用服务平台\plugins\jewelry\images'
sizes_png = [200, 300, 400, 600, 800, 1000]
ico_sizes = [16, 24, 32, 48, 64, 128, 256]

for name in ['icon_A', 'icon_B', 'icon_C']:
    src = os.path.join(root, f'{name}.png')
    im = Image.open(src).convert('RGBA')
    # PNG 尺寸包
    for s in sizes_png:
        out = im.resize((s, s), Image.LANCZOS)
        out.save(os.path.join(root, f'{name}_{s}px.png'))
        print(f'{name}_{s}px.png -> {out.size}')
    # ICO（含全部常用尺寸）
    ico_path = os.path.join(root, f'{name}.ico')
    im.save(ico_path, format='ICO', sizes=[(s, s) for s in ico_sizes])
    print(f'{name}.ico -> {ico_path}')
print('ALL DONE')
