from PIL import Image, ImageDraw, ImageFont, ImageFilter
S=2048; k=S/512
NAVY=(16,24,32,255); YEL=(255,209,102,255); WHITE=(255,255,255,255); DIM=(58,74,92,255); GREEN=(31,122,82,255); GRN2=(93,211,158,255)
POP='/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf'
def font(px): return ImageFont.truetype(POP, int(px*k))
def R(d, x0,y0,x1,y1, r, fill, outline=None, w=0): d.rounded_rectangle([x0*k,y0*k,x1*k,y1*k], radius=r*k, fill=fill, outline=outline, width=int(w*k))
def ctext(d, cx, cy, s, f, fill):
    b=d.textbbox((0,0), s, font=f); d.text((cx*k-(b[0]+b[2])/2, cy*k-(b[1]+b[3])/2), s, font=f, fill=fill)
def save(im, name): im.resize((512,512), Image.LANCZOS).save(f'.dev/icons/{name}.png'); return Image.open(f'.dev/icons/{name}.png')

# A — wordmark: "Word" white + "Light" yellow, a lit bar under "Light" (the highlighted word)
im=Image.new('RGBA',(S,S),NAVY); d=ImageDraw.Draw(im); f=font(78)
wb=d.textbbox((0,0),'Word',font=f); lb=d.textbbox((0,0),'Light',font=f); W=(wb[2]-wb[0])+(lb[2]-lb[0])
x0=(S-W)/2; y=256*k-(wb[1]+wb[3])/2-10*k
d.text((x0-wb[0],y),'Word',font=f,fill=WHITE); xl=x0+(wb[2]-wb[0]); d.text((xl-lb[0],y),'Light',font=f,fill=YEL)
d.rounded_rectangle([xl, 292*k, xl+(lb[2]-lb[0]), 306*k], radius=8*k, fill=YEL)
A=save(im,'A-wordmark')

# B — speech bubble (reading aloud) holding an open book, on yellow
im=Image.new('RGBA',(S,S),YEL); d=ImageDraw.Draw(im)
R(d,104,128,408,340,64,NAVY); d.polygon([(150*k,330*k),(214*k,330*k),(136*k,392*k)],fill=NAVY)
d.polygon([(158*k,190*k),(250*k,178*k),(256*k,188*k),(256*k,300*k),(250*k,292*k),(158*k,300*k)],fill=YEL)
d.polygon([(354*k,190*k),(262*k,178*k),(256*k,188*k),(256*k,300*k),(262*k,292*k),(354*k,300*k)],fill=YEL)
for i,(a,b) in enumerate([(172,236),(172,220),(172,240)]): R(d,a,206+i*28,b,218+i*28,6,NAVY)
for i,(a,b,c) in enumerate([(272,340,NAVY),(272,334,(255,255,255,255)),(272,326,NAVY)]): R(d,a,206+i*28,b,218+i*28,6,c)
B=save(im,'B-bubble-book')

# C — the app's own reading-turn chips: one lit word chip "Aa" between dim chips
im=Image.new('RGBA',(S,S),NAVY); d=ImageDraw.Draw(im)
R(d,18,214,98,298,22,None,DIM,8); R(d,414,214,494,298,22,None,DIM,8)
R(d,120,160,392,352,52,YEL); ctext(d,256,252,'Aa',font(150),NAVY)
R(d,120,160,392,352,52,None,(255,255,255,255),8)
C=save(im,'C-lit-chip')

# preview sheet: launcher tile (centre 16:9 crop, as the launcher showed it) + square (Settings)
bg=Image.new('RGB',(1500,760),(6,12,22)); dd=ImageDraw.Draw(bg); lab=ImageFont.truetype(POP,24); sm=ImageFont.truetype(POP,18)
for i,(n,ic) in enumerate([('A  wordmark',A),('B  bubble + book',B),('C  lit word chip',C)]):
    x=60+i*480
    dd.text((x,30),n,font=lab,fill=(255,209,102))
    tile=ic.crop((0,112,512,400)).resize((380,214),Image.LANCZOS); m=Image.new('L',tile.size,0); ImageDraw.Draw(m).rounded_rectangle([0,0,379,213],radius=10,fill=255)
    bg.paste(tile,(x,80),m); dd.text((x+150,300),'WordLight',font=sm,fill=(230,230,230))
    dd.text((x,350),'launcher tile ↑   settings icon ↓',font=sm,fill=(140,150,165))
    bg.paste(ic.resize((300,300),Image.LANCZOS).convert('RGB'),(x+40,400))
bg.save('.dev/icons/compare.png')
