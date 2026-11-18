"""Create monumental Hanyuan Hall HIGH/LOW assets from palace-layout.json.

Run from the project root:
F:\\blender\\blender.exe --background --factory-startup --gpu-backend opengl --python scripts/build_palace.py
The modelling helpers use Three.js x/height/z metres.
"""
from __future__ import annotations
import json
import math
from collections import defaultdict
from pathlib import Path
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'public' / 'assets'
SOURCE = ROOT / 'assets-source'
LAYOUT = json.loads((OUT / 'palace-layout.json').read_text(encoding='utf-8'))
OUT.mkdir(parents=True, exist_ok=True)
SOURCE.mkdir(parents=True, exist_ok=True)
FY, CZ = float(LAYOUT['floorHeight']), float(LAYOUT['worldPosition'][2])
BODY, FZ = LAYOUT['body'], float(LAYOUT['entrance']['localZ'])
DH, HW = LAYOUT['entrance']['width'] / 2, LAYOUT['body']['width'] / 2
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)


def rgba(h):
    def linear(c): return c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4
    return tuple(linear(int(h[i:i+2], 16) / 255) for i in (1, 3, 5)) + (1,)


def material(name, color, metallic=0, roughness=.8, emission=None):
    m=bpy.data.materials.new(name); m.diffuse_color=rgba(color); m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value=rgba(color)
    p.inputs['Metallic'].default_value=metallic; p.inputs['Roughness'].default_value=roughness
    if emission: p.inputs['Emission Color'].default_value=rgba(emission); p.inputs['Emission Strength'].default_value=1.6
    return m


MATS={
 'stone':material('Pale carved limestone','#c4bda8',roughness=.92),'edge':material('Limestone shadows','#8e938c',roughness=.96),
 'floor':material('Aged polished timber','#68523d',roughness=.73),'red':material('Vermilion lacquer columns','#93452e',roughness=.44),
 'wood':material('Dark cedar beams','#3b3029',roughness=.7),'teal':material('Blue-green bracket paint','#426d62',roughness=.72),
 'roof':material('Charcoal blue glazed tiles','#2c414c',roughness=.62),'rib':material('Glazed cap tile edges','#526773',roughness=.48),
 'gold':material('Warm gilded ornaments','#caa151',metallic=.52,roughness=.36),'paper':material('Linen window screens','#c6b68e',roughness=.95),
 'silk':material('Ceremonial crimson silk','#833d34',roughness=.92),'lantern':material('Amber lantern silk','#db9b4b',emission='#ffb455'),
 'ink':material('Gilded inscription','#e5ca87',metallic=.35)}


class Builder:
    def __init__(self,detail): self.detail=detail; self.data=defaultdict(lambda:{'v':[],'f':[],'smooth':[]})
    def geo(self,mat,v,f,smooth=False):
        d=self.data[mat];o=len(d['v']);d['v'].extend(v);d['f'].extend(tuple(o+i for i in face) for face in f);d['smooth'].extend([smooth]*len(f))
    def box(self,mat,x,y,z,w,h,d):
        v=[(x+a*w/2,y+b*h/2,z+c*d/2) for a,b,c in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
        self.geo(mat,v,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(3,7,6,2),(1,2,6,5),(0,4,7,3)])
    def beam(self,mat,a,b,r,sides=8,end=None):
        sides=max(4,min(sides,10 if self.detail else 4));a,b=Vector(a),Vector(b);axis=(b-a).normalized()
        u=axis.cross(Vector((0,1,0)) if abs(axis.y)<.95 else Vector((1,0,0))).normalized();v=axis.cross(u).normalized();end=r if end is None else end;verts=[]
        for center,rad in [(a,r),(b,end)]:
            for i in range(sides): verts.append(tuple(center+rad*(u*math.cos(i*math.tau/sides)+v*math.sin(i*math.tau/sides))))
        faces=[tuple(reversed(range(sides))),tuple(range(sides,sides*2))]+[(i,(i+1)%sides,(i+1)%sides+sides,i+sides) for i in range(sides)]
        self.geo(mat,verts,faces,True)
    def sphere(self,mat,c,radii,segments=10,rings=6):
        segments=min(segments,10 if self.detail else 6);rings=min(rings,6 if self.detail else 4);v=[];f=[]
        for j in range(rings+1):
            p=math.pi*j/rings
            for i in range(segments):
                a=math.tau*i/segments;v.append((c[0]+radii[0]*math.sin(p)*math.cos(a),c[1]+radii[1]*math.cos(p),c[2]+radii[2]*math.sin(p)*math.sin(a)))
        for j in range(rings):
            for i in range(segments):
                q=j*segments+i;f.append((q,j*segments+(i+1)%segments,(j+1)*segments+(i+1)%segments,q+segments))
        self.geo(mat,v,f,True)
    def line(self,mat,pts,r,sides=6):
        for a,b in zip(pts,pts[1:]): self.beam(mat,a,b,r,sides)
    def ramp(self,half,z0,z1,y0,y1):
        self.geo('stone',[(-half,y0,z0),(half,y0,z0),(half,y1,z1),(-half,y1,z1),(-half,0,z1),(half,0,z1),(-half,0,z0),(half,0,z0)],[(0,3,2,1),(0,6,4,3),(1,2,5,7),(3,4,5,2),(0,1,7,6)])
    def rail(self,a,b,y,spacing=4.4):
        ax,az=a;bx,bz=b;n=max(1,math.ceil(math.hypot(bx-ax,bz-az)/(spacing if self.detail else spacing*1.7)))
        for i in range(n+1):
            t=i/n;x=ax+(bx-ax)*t;z=az+(bz-az)*t
            if self.detail:self.box('edge',x,y+.12,z,.5,.24,.5)
            self.beam('stone',(x,y+.24,z),(x,y+1.22,z),.135,8);self.box('stone',x,y+1.26,z,.43,.16,.43)
            if self.detail:self.sphere('stone',(x,y+1.43,z),(.2,.18,.2),8,4)
        for h in [.59,1.12]:self.beam('stone',(ax,y+h,az),(bx,y+h,bz),.075,6)
    def rail_slope(self,x,z0,z1,y0,y1):
        for h in [.55,1.12]:self.line('stone',[(x,y0+h,z0),(x,y1+h,z1)],.09)
        n=4 if self.detail else 2
        for i in range(n+1):
            t=i/n;z=z0+(z1-z0)*t;y=y0+(y1-y0)*t;self.beam('stone',(x,y+.1,z),(x,y+1.22,z),.13,6);self.box('stone',x,y+1.28,z,.4,.15,.4)
    def pillar(self,x,z,height=None,r=.52):
        h=height or BODY['columnHeight'];self.beam('edge',(x,FY,z),(x,FY+.28,z),r*1.65,10);self.beam('stone',(x,FY+.28,z),(x,FY+.5,z),r*1.3,10);self.beam('red',(x,FY+.5,z),(x,FY+h,z),r,10,r*.88)
        for yy in [.58,h-.38]:self.beam('gold',(x,FY+yy,z),(x,FY+yy+.12,z),r*1.04,8)
        for lev in range(3 if self.detail else 1):
            yy=FY+h+lev*.28;span=1.45+lev*.6;self.box('teal' if lev%2 else 'red',x,yy,z,span,.25,.65);self.box('red' if lev%2 else 'teal',x,yy+.11,z,.65,.25,span)
            if self.detail:
                for s in [-1,1]:self.box('gold',x+s*span*.36,yy+.16,z,.3,.08,.65)
    def lattice(self,x,z,w,height=8.3,base=None,side=False):
        base=FY+.65 if base is None else base;self.box('paper',x,base+height/2,z,.2 if side else w,height,w if side else .2);n=max(2,round(w/(.65 if self.detail else 2.7)))
        for i in range(n+1):
            off=-w/2+i*w/n;self.box('red',x if side else x+off,base+height/2,z+off if side else z,.27 if side else .09,height,.09 if side else .27)
        levels=6 if self.detail else 2
        for j in range(levels+1):self.box('red',x,base+j*height/levels,z,.28 if side else w,.09,w if side else .28)
        for yy in [base-.15,base+height+.12]:self.box('wood',x,yy,z,.34 if side else w+.08,.23,w+.08 if side else .34)
    def roof(self,hw,hd,eave,rise,ridge):
        def p(x,z,lift=0):
            slope=min(1,max(max(0,abs(x)-ridge)/(hw-ridge),abs(z)/hd));curve=(1-slope)**1.5;corner=max(0,(abs(x)/hw-.68)/.32)**2*max(0,(abs(z)/hd-.7)/.3)**2
            return (x,eave+rise*curve+1.15*corner+lift,z)
        nx,nz=(44,26) if self.detail else (18,12);v=[p(-hw+i*2*hw/nx,-hd+j*2*hd/nz) for j in range(nz+1) for i in range(nx+1)]
        f=[(j*(nx+1)+i,(j+1)*(nx+1)+i,(j+1)*(nx+1)+i+1,j*(nx+1)+i+1) for j in range(nz) for i in range(nx)];self.geo('roof',v,f,True);n=24 if self.detail else 10
        for z in [-hd,hd]:
            pts=[p(-hw+i*2*hw/n,z,-.02) for i in range(n+1)];self.line('wood',pts,.2,6)
            if self.detail:self.line('gold',[(x,y+.08,zz) for x,y,zz in pts],.045,4)
        for x in [-hw,hw]:self.line('wood',[p(x,-hd+i*2*hd/n,-.02) for i in range(n+1)],.2,6)
        if self.detail:
            n=round(hw*2/(.82 if self.detail else 1.2))
            for s in [-1,1]:
                for i in range(n+1):
                    x=-hw+2*hw*i/n;start=min(hd,max(0,(abs(x)-ridge)/(hw-ridge)*hd));self.line('rib',[p(x,s*(start+(hd-start)*j/7),.055) for j in range(8)],.05,4)
                for row in range(1,9):
                    zz=s*hd*row/9;edge=ridge+(hw-ridge)*row/9;self.line('rib',[p(-edge+2*edge*i/16,zz,.028) for i in range(17)],.025,4)
        for sx in [-1,1]:
            for sz in [-1,1]:
                n=12 if self.detail else 6;self.line('rib',[p(sx*(ridge+(hw-ridge)*i/n),sz*hd*i/n,.16) for i in range(n+1)],.19,6);tip=p(sx*hw*.988,sz*hd*.988,.35);self.sphere('gold',(tip[0],tip[1]+.25,tip[2]),(.23,.38,.23),8,4)
        self.beam('rib',(-ridge,eave+rise+.17,0),(ridge,eave+rise+.17,0),.32,8);self.beam('gold',(-ridge,eave+rise+.4,0),(ridge,eave+rise+.4,0),.075,6)
        for s in [-1,1]:self.line('gold',[(s*(ridge-.2),eave+rise+.2,0),(s*(ridge+.55),eave+rise+.7,0),(s*(ridge+.6),eave+rise+1.1,0),(s*(ridge+.2),eave+rise+1.4,0)],.19,6)
    def lantern(self,x,y,z,s=1):
        self.beam('wood',(x,y+.6*s,z),(x,y+1.3*s,z),.045*s,6);self.sphere('lantern',(x,y,z),(.42*s,.6*s,.42*s),10,6)
        for yy in [-.58,.58]:self.beam('gold',(x,y+(yy-.05)*s,z),(x,y+(yy+.05)*s,z),.2*s,8)
        self.beam('silk',(x,y-.6*s,z),(x,y-1.1*s,z),.04*s,6)
        if self.detail:
            for i in range(6):
                a=i*math.tau/6;self.line('red',[(x+.425*s*math.sin(q)*math.cos(a),y+.6*s*math.cos(q),z+.425*s*math.sin(q)*math.sin(a)) for q in [.2+j*(math.pi-.4)/6 for j in range(7)]],.023*s,4)
    def finish(self,collection):
        out=[]
        for key,b in self.data.items():
            mesh=bpy.data.meshes.new(f'{collection.name} · {key}');mesh.from_pydata([(x,-z,y) for x,y,z in b['v']],[],b['f']);mesh.materials.append(MATS[key]);mesh.update()
            for poly,smooth in zip(mesh.polygons,b['smooth']):poly.use_smooth=smooth
            obj=bpy.data.objects.new(mesh.name,mesh);collection.objects.link(obj);out.append(obj)
        return out


def build(detail):
    b=Builder(detail)
    for i,t in enumerate(LAYOUT['terraces']):
        y,w,z0,z1=t['height'],t['width'],t['minZ'],t['maxZ'];depth=z1-z0;center=(z0+z1)/2
        b.box('edge',0,y-.23,center,w+.28,.24,depth+.2);b.box('stone',0,y/2,center,w,y,depth);b.box('stone',0,y+.025,center,w+.3,.05,depth+.3)
        for side in [-1,1]:
            b.rail((side*(w/2-.65),z0+.7),(side*(w/2-.65),z1-.7),y);gap=LAYOUT['stairFlights'][i]['width']/2+.6;b.rail((side*gap,z1-.5),(side*(w/2-.7),z1-.5),y)
        if detail:
            for xx in range(-int(w/2)+3,int(w/2),5):
                b.box('edge',xx,y-1.05,z1+.012,2.5,.075,.018);b.box('edge',xx,y-1.85,z1+.012,2.5,.075,.018)
        if i==2:b.rail((-w/2+.7,z0+.7),(w/2-.7,z0+.7),y)
    for f in LAYOUT['stairFlights']:
        z0,z1=f['startZ']-CZ,f['endZ']-CZ;y0,y1=f['startHeight'],f['endHeight'];n=f['steps'];run=(z0-z1)/n;rise=(y1-y0)/n;half=f['width']/2;central=LAYOUT['ceremonialRampWidth']/2
        for i in range(n):
            yy=y0+rise*(i+1);zz=z0-run*(i+.5)
            for s in [-1,1]:
                width=half-central;b.box('stone',s*(central+width/2),yy/2,zz,width,yy,run+.012)
                if detail:b.box('edge',s*(central+width/2),yy-.025,zz+run/2-.02,width,.045,.04)
        b.ramp(central,z0,z1,y0+.02,y1+.02)
        for s in [-1,1]:b.rail_slope(s*(half+.2),z0,z1,y0,y1)
        if detail:
            for s in [-1,1]:b.line('gold',[(s*(central-.18),y0+.06,z0),(s*(central-.18),y1+.06,z1)],.034,4)
        if detail:
            for j in range(3):
                t=(j+.5)/3;zz=z0+(z1-z0)*t;yy=y0+(y1-y0)*t+.04
                for s in [-1,1]:b.line('edge',[(s*.55,yy,zz-.5),(s*1.4,yy+.05,zz),(s*.55,yy+.1,zz+.5)],.045,4)
    for land in LAYOUT['landings']:
        z0,z1=land['startZ']-CZ,land['endZ']-CZ
        for s in [-1,1]:b.rail((s*(land['width']/2+.2),z0),(s*(land['width']/2+.2),z1),land['height'],3)
    b.box('floor',0,FY+.055,0,BODY['width']-.8,.11,BODY['depth']-.8)
    xs=[-29.1,-21.8,-14.55,-7.3,7.3,14.55,21.8,29.1]
    for x in xs:
        for z in [-FZ,FZ]:b.pillar(x,z)
    for z in [-7.75,0,7.75]:
        for x in [-29.1,29.1]:b.pillar(x,z)
    for x in [-19.4,-9.7,9.7,19.4]:
        for z in [-7.5,7.5]:b.pillar(x,z,height=13.9,r=.47)
    for c in LAYOUT['localWallColliders'][:5]:
        b.box('red',(c['minX']+c['maxX'])/2,FY+.45,(c['minZ']+c['maxZ'])/2,c['maxX']-c['minX'],.9,c['maxZ']-c['minZ'])
    for s in [-1,1]:
        for a,z in [(6.05,13.6),(14.1,21.1),(21.65,28.7)]:b.lattice(s*(a+z)/2,FZ,z-a);b.lattice(s*(a+z)/2,FZ,z-a,3,FY+9.3)
    for i in range(8):
        w=BODY['width']/8-.18;x=-BODY['width']/2+(i+.5)*BODY['width']/8;b.lattice(x,-FZ,w);b.lattice(x,-FZ,w,3,FY+9.3)
    for s in [-1,1]:
        for i in range(4):
            z=-FZ+(i+.5)*2*FZ/4;b.lattice(s*29.1,z,7.45,side=True);b.lattice(s*29.1,z,7.45,3,FY+9.3,True)
        b.box('red',s*6.2,FY+4.3,FZ-1,.34,8.4,1.65);b.box('gold',s*6.02,FY+4.3,FZ-1,.045,.65,.18)
    b.box('wood',0,FY+10.25,FZ,12.3,3.5,.55)
    for y,h,mat in [(FY+13.25,.55,'wood'),(FY+13.65,.2,'gold'),(FY+14,.4,'teal')]:
        for z in [-FZ,FZ]:b.box(mat,0,y,z,61,h,.7)
        for x in [-29.1,29.1]:b.box(mat,x,y,0,.7,h,32)
    for z in [-FZ,FZ]:b.box('wood',0,FY+15.1,z,61,2.1,.4)
    for x in [-29.1,29.1]:b.box('wood',x,FY+15.1,0,.4,2.1,32)
    b.roof(35,21.5,24,4.8,17);b.box('red',0,28.65,0,43,2.2,20)
    for x in range(-20,21,4):
        for z in [-10.1,10.1]:b.box('wood',x,29,z,2.8,.9,.16);b.box('gold',x,29.5,z,2.9,.06,.18)
    b.roof(27,15,30,4.8,13)
    for x in [-24,-16,-8,0,8,16,24]:
        b.box('wood',x,22.3,0,.45,.58,30.4)
        if detail:b.box('gold',x,21.98,0,.085,.08,29.8)
    for z in [-11,-5.5,0,5.5,11]:b.box('red',0,22.75,z,57,.5,.46)
    b.box('silk',0,FY+.12,2.8,7.5,.02,25.2)
    for s in [-1,1]:b.box('gold',s*3.62,FY+.135,2.8,.04,.015,25)
    for lev in range(5 if detail else 3):
        size=13-lev*1.5;y=23.05+lev*.4
        for s in [-1,1]:b.box('gold' if lev%2 else 'teal',s*size/2,y,0,.3,.28,size);b.box('gold' if lev%2 else 'teal',0,y,s*size/2,size,.28,.3)
    b.sphere('gold',(0,25.05,0),(1,.18,1),12,6)
    for i in range(3):b.box('stone' if i==0 else 'red',0,FY+.18+i*.22,-10.2,14.4-i*.6,.3,6.4-i*.35)
    b.box('silk',0,FY+.79,-10.2,12.7,.03,5.3);b.box('wood',0,FY+4.4,-13,13.5,7.2,.46);b.box('gold',0,FY+4.4,-12.74,12.8,6.6,.09);b.box('red',0,FY+4.4,-12.66,12.3,6.1,.09)
    for x in [-5,-2.5,0,2.5,5]:b.beam('gold',(x,FY+1.5,-12.55),(x,FY+7.3,-12.55),.08,6)
    if detail:
        for s in [-1,1]:b.line('gold',[(s*(2.5+1.25*math.cos(i*math.tau/24)),FY+4.4+1.2*math.sin(i*math.tau/24),-12.5) for i in range(25)],.07,5)
    b.box('gold',0,FY+1.65,-10.2,5,.4,2.6);b.box('silk',0,FY+1.91,-9.95,4.5,.2,2.1);b.box('gold',0,FY+3.25,-11.4,5.2,3.1,.35);b.box('silk',0,FY+3.2,-11.17,4.6,2.6,.12)
    for s in [-1,1]:
        for z in [-11,-9.2]:b.beam('gold',(s*2.22,FY+.8,z),(s*2.22,FY+2.85,z),.17,8)
        b.box('gold',s*2.22,FY+2.8,-10.2,.3,.25,2.5);b.sphere('gold',(s*2.22,FY+2.95,-8.95),(.25,.3,.34),10,6)
    b.box('wood',0,FY+1.42,-7.8,6.7,.22,1.25)
    for x in [-2.8,2.8]:
        for z in [-8.2,-7.4]:b.beam('red',(x,FY+.75,z),(x,FY+1.4,z),.12,6)
    for x in [-25,-18,-11,11,18,25]:b.lantern(x,20.45,FZ+.8,1.65)
    for x in [-14,14]:
        for z in [-7.5,6]:b.lantern(x,18.4,z,1.65)
    for s in [-1,1]:
        for z in [-8,7]:
            x=s*8.2;b.beam('gold',(x,FY,z),(x,FY+3.6,z),.13,8);b.beam('gold',(x,FY,z),(x,FY+.23,z),.57,10,.3);b.sphere('lantern',(x,FY+3.8,z),(.32,.43,.32),8,5)
    b.box('wood',0,FY+11.4,FZ+.62,10.3,2.1,.3)
    for y in [FY+10.42,FY+12.38]:b.box('gold',0,y,FZ+.82,10.1,.075,.07)
    for x in [-5.02,5.02]:b.box('gold',x,FY+11.4,FZ+.82,.075,2,.07)
    return b


def inscription(collection):
    c=bpy.data.curves.new(f'{collection.name} inscription','FONT');c.body='含元殿';c.align_x='CENTER';c.align_y='CENTER';c.size=1;c.extrude=.01
    f=Path('C:/Windows/Fonts/simkai.ttf')
    if f.exists():c.font=bpy.data.fonts.load(str(f))
    obj=bpy.data.objects.new(c.name,c);collection.objects.link(obj);obj.location=(0,-FZ-.86,FY+11.4);obj.rotation_euler=(math.pi/2,0,0);obj.data.materials.append(MATS['ink'])
    bpy.context.view_layer.update()
    if obj.dimensions.x:obj.scale*=7.2/obj.dimensions.x
    bpy.context.view_layer.objects.active=obj;obj.select_set(True);bpy.ops.object.convert(target='MESH');obj.select_set(False)
    return obj


def triangles(objects):
    n=0
    for o in objects:o.data.calc_loop_triangles();n+=len(o.data.loop_triangles)
    return n


versions={}
for name,detail in [('HIGH',True),('LOW',False)]:
    col=bpy.data.collections.new(f'Hanyuan Hall · {name}');bpy.context.scene.collection.children.link(col)
    objs=build(detail).finish(col);objs.append(inscription(col));versions[name]={'collection':col,'objects':objs,'triangles':triangles(objs)}

if versions['LOW']['triangles']>25000:
    for obj in versions['LOW']['objects']:
        if obj.data.materials[0] in [MATS['gold'], MATS['ink']]: continue
        bpy.context.view_layer.objects.active=obj;obj.select_set(True)
        mod=obj.modifiers.new('Distant architectural simplification','DECIMATE');mod.ratio=.72
        bpy.ops.object.modifier_apply(modifier=mod.name);obj.select_set(False)
        obj.data.validate(verbose=False, clean_customdata=True);obj.data.update()
    versions['LOW']['triangles']=triangles(versions['LOW']['objects'])
assert versions['HIGH']['triangles']<=140000,versions['HIGH']['triangles']
assert versions['LOW']['triangles']<=25000,versions['LOW']['triangles']
for name,d in versions.items():
    bpy.ops.object.select_all(action='DESELECT')
    for o in d['objects']:o.select_set(True)
    filename='palace.glb' if name=='HIGH' else 'palace-low.glb'
    bpy.ops.export_scene.gltf(filepath=str(OUT/filename),export_format='GLB',use_selection=True,export_cameras=False,export_lights=False,export_yup=True,export_materials='EXPORT')
    d['meshCount']=len(d['objects']);d['bytes']=(OUT/filename).stat().st_size
    bpy.ops.object.select_all(action='DESELECT')

# Keep the source convenient to open and edit; both detail collections remain separate.
versions['HIGH']['collection'].hide_viewport=False;versions['HIGH']['collection'].hide_render=False
versions['LOW']['collection'].hide_viewport=True;versions['LOW']['collection'].hide_render=True
for scr in bpy.data.screens:
    for area in scr.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.region_3d.view_distance=126;area.spaces.active.region_3d.view_location=(0,0,18);area.spaces.active.region_3d.view_perspective='PERSP';area.spaces.active.shading.type='MATERIAL';area.spaces.active.clip_end=1800
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'palace.blend'))
manifest={**LAYOUT,'name':'含元殿 · original monumental Tang-inspired hall','historical_reconstruction':False,'generator':'scripts/build_palace.py','source':'assets-source/palace.blend','assets':{n:{'model':'/assets/palace.glb' if n=='HIGH' else '/assets/palace-low.glb','meshCount':d['meshCount'],'triangles':d['triangles'],'bytes':d['bytes']} for n,d in versions.items()},'lodHint':'Use palace-low.glb for overview beyond 150 m; use palace.glb for close exterior and interior.'}
(OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print('PALACE_EXPORT_COMPLETE '+json.dumps({n:{k:d[k] for k in ['meshCount','triangles','bytes']} for n,d in versions.items()},ensure_ascii=False))
