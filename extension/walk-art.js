/* Original v3 foreground over four static far-side artwork poses. */
(function(global){
  "use strict";
  if(global.IKnowReaderWalkArt)return;
  const NS="http://www.w3.org/2000/svg", DATA={"version":1,"canvas":176,"atlas":1254,"scale":0.28,"positions":[[-1.6,-4.52],[-173.24,-4.52],[-1.6,-166.77],[-173.24,-166.77]],"cellClips":[[10.28,13.96,155.44,153.04],[10.28,13.96,155.44,153.04],[10.28,15.23,155.44,151.77],[10.28,15.23,155.44,151.77]],"holes":[{"leg":[[76.8,140.5],[78.2,141.7],[80.2,143.3],[82.2,145.1],[84.2,146.9],[86.4,149],[87,149.8],[87,151],[95,151],[95,167],[66,167],[66,151],[68.6,148.6],[70.2,145.1],[72.3,141.1],[74,138]],"hand":[],"extra":[]},{"leg":[[112,144.7],[115.2,143.9],[119.4,143.2],[123,141.9],[126.3,139.6],[129,138.4],[132,140],[133,142],[139,142],[139,164],[110,164],[110,150],[111.1,147.4]],"hand":[[136.5,128],[140,128],[143.2,129],[145.5,131.5],[146,135],[145,138],[142,141],[138.5,143.5],[130,143.5],[128,142],[129,139],[132,137],[134.5,135],[134.5,132],[135,130]],"extra":[[127,142],[134,140],[140,146],[140,154],[125,154]]},{"leg":[[73.5,140.2],[75.2,141.6],[77.2,143.1],[79.2,144.7],[81.2,145.9],[83.2,148.6],[85.2,149.6],[85,151],[98,151],[98,167],[66,167],[66,151],[68.8,146.7],[70.9,143.4],[73,140.2]],"hand":[],"extra":[]},{"leg":[[88.5,136.8],[90.2,139.1],[92.2,140.1],[94.2,141.8],[96.3,144.2],[98.3,145.7],[100.3,148.1],[95,151],[109,151],[109,167],[79,167],[79,151],[82.3,148],[84,144.6],[84.9,140.8]],"hand":[],"extra":[]}],"legKind":"raster-source","legSources":[0,0,0,3],"legOffsets":[[0,0],[24,-5],[12,0],[0,0]],"legSourceClips":[[[76.5,139.8],[78,141.2],[80,142.8],[82,144],[82.5,145.5],[84,147],[85,148.5],[86,150],[85,151],[84.5,152.8],[87.5,153.5],[90.5,156.5],[91,159],[91,162],[89,164.5],[86,166],[72,166],[68,163],[65.5,158],[65.5,152.8],[68.6,148.6],[70.2,145.1],[72.3,141.1],[74,138]],[[76.5,139.8],[78,141.2],[80,142.8],[82,144],[82.5,145.5],[84,147],[85,148.5],[86,150],[85,151],[84.5,152.8],[87.5,153.5],[90.5,156.5],[91,159],[91,162],[89,164.5],[86,166],[72,166],[68,163],[65.5,158],[65.5,152.8],[68.6,148.6],[70.2,145.1],[72.3,141.1],[74,138]],[[76.5,139.8],[78,141.2],[80,142.8],[82,144],[82.5,145.5],[84,147],[85,148.5],[86,150],[85,151],[84.5,152.8],[87.5,153.5],[90.5,156.5],[91,159],[91,162],[89,164.5],[86,166],[72,166],[68,163],[65.5,158],[65.5,152.8],[68.6,148.6],[70.2,145.1],[72.3,141.1],[74,138]],[[88.5,136.8],[90.2,139.1],[92.2,140.1],[94.2,141.8],[96.3,144.2],[98.3,145.7],[100.3,148.1],[95,151],[109,151],[109,167],[79,167],[79,151],[82.3,148],[84,144.6],[84.9,140.8]]],"handSources":[1,1,1,1],"handOffsets":[[2,0],[-2,0],[2,0],[1,0]],"handClip":"M132 124H150V144H135V140H132Z","foregroundAlphaBins":20};
  let serial=0;
  function resource(value){
    if(typeof value!=="string"||value.length>512)return null;
    try{const url=new URL(value),own=global.chrome&&global.chrome.runtime&&global.chrome.runtime.id;
      if(url.protocol!=="chrome-extension:"||!/^[a-p]{32}$/.test(url.hostname)||!/^\/assets\/[A-Za-z0-9_-]+\.png$/.test(url.pathname)||url.port||url.username||url.password||url.search||url.hash||(own&&url.hostname!==own))return null;
      return url;
    }catch(_){return null;}
  }
  function mount(walk,options){
    if(!walk||walk.nodeType!==1||!walk.ownerDocument||!options)return false;
    const original=resource(options.original),edited=resource(options.edited);
    if(!original||!edited||original.hostname!==edited.hostname||original.pathname!=="/assets/reading-fox-walk-v3.png")return false;
    const doc=walk.ownerDocument,prefix="ikr-walk-art-"+(++serial)+"-",fragment=doc.createDocumentFragment();
    const id=name=>prefix+name;
    function node(tag,attrs,children){const n=doc.createElementNS(NS,tag);for(const [key,value]of Object.entries(attrs||{}))n.setAttribute(key,String(value));for(const child of children||[])n.appendChild(child);return n;}
    const path=points=>points.length?"M"+points.map(p=>p.join(" ")).join("L")+"Z":"";
    const ref=name=>"url(#"+id(name)+")";
    function imagePose(kind,index,offset){const p=DATA.positions[index],delta=offset||[0,0];return node("use",{href:"#"+id(kind),transform:"translate("+(p[0]+delta[0])+" "+(p[1]+delta[1])+") scale("+DATA.scale+")"});}
    function originalPose(index){return node("g",{"clip-path":ref("cell-"+index)},[imagePose("original",index)]);}
    const definitions=node("svg",{class:"ikr-walk-definitions",width:0,height:0,"aria-hidden":"true",focusable:"false",style:"position:absolute;overflow:hidden;pointer-events:none"});
    const defs=node("defs");definitions.appendChild(defs);
    defs.appendChild(node("image",{id:id("original"),href:original.href,width:DATA.atlas,height:DATA.atlas,style:"image-rendering:pixelated"}));
    defs.appendChild(node("image",{id:id("edited"),href:edited.href,width:DATA.atlas,height:DATA.atlas,style:"image-rendering:pixelated"}));
    const filter=node("filter",{id:id("foreground"),filterUnits:"userSpaceOnUse",x:0,y:0,width:DATA.canvas,height:DATA.canvas,"color-interpolation-filters":"sRGB"},[
      node("feColorMatrix",{type:"matrix",values:"0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"}),
      node("feComponentTransfer",{},[node("feFuncA",{type:"discrete",tableValues:"0 "+Array(DATA.foregroundAlphaBins-1).fill(1).join(" ")})])
    ]);defs.appendChild(filter);
    defs.appendChild(node("clipPath",{id:id("hand")},[node("path",{d:DATA.handClip})]));
    for(let index=0;index<4;index++){
      const clip=DATA.cellClips[index],holes=DATA.holes[index],all=path(holes.leg)+path(holes.hand)+path(holes.extra);
      defs.appendChild(node("clipPath",{id:id("cell-"+index)},[node("rect",{x:clip[0],y:clip[1],width:clip[2],height:clip[3]})]));
      for(const kind of ["leg","hand","extra"]){
        defs.appendChild(node("clipPath",{id:id("keep-"+kind+"-"+index),clipPathUnits:"userSpaceOnUse"},[node("path",{"clip-rule":"evenodd",d:"M0 0H176V176H0Z"+path(holes[kind])})]));
      }
      defs.appendChild(node("clipPath",{id:id("leg-source-"+index)},[node("path",{d:path(DATA.legSourceClips[index])})]));
      defs.appendChild(node("mask",{id:id("underlay-"+index),maskUnits:"userSpaceOnUse",x:0,y:0,width:DATA.canvas,height:DATA.canvas,style:"mask-type:luminance"},[
        node("rect",{width:DATA.canvas,height:DATA.canvas,fill:"white"}),
        node("g",{filter:ref("foreground"),"clip-path":ref("cell-"+index)},[imagePose("original",index)]),
        node("path",{d:all,fill:"white"})
      ]));
    }
    fragment.appendChild(definitions);
    for(let index=0;index<4;index++){
      const delta=DATA.legOffsets[index];
      const leg=node("g",{transform:"translate("+delta.join(" ")+")"},[
        node("g",{"clip-path":ref("leg-source-"+index)},[originalPose(DATA.legSources[index])])
      ]);
      const under=node("g",{mask:ref("underlay-"+index)},[leg,node("g",{"clip-path":ref("hand")},[imagePose("edited",DATA.handSources[index],DATA.handOffsets[index])])]);
      let front=originalPose(index);
      // Intersect the three complements. A single even-odd path would restore their overlaps.
      for(const kind of ["extra","hand","leg"])front=node("g",{"clip-path":ref("keep-"+kind+"-"+index)},[front]);
      const frame=node("svg",{class:"ikr-walk-frame ikr-walk-frame-"+index+" ikr-walk-art-frame","data-ikr-walk-art":"1",width:DATA.canvas,height:DATA.canvas,viewBox:"0 0 176 176","aria-hidden":"true",focusable:"false",style:"background-image:none;image-rendering:pixelated"},[under,front]);
      fragment.appendChild(frame);
    }
    walk.replaceChildren(fragment);walk.setAttribute("data-ikr-walk-art","1");return true;
  }
  global.IKnowReaderWalkArt=Object.freeze({mount,version:DATA.version});
})(globalThis);
