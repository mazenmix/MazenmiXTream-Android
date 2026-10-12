(() => {
"use strict";
const KEY="mxtv.web.premium.v1", LEGACY="mazenmixtream.state.v1";
const $=id=>document.getElementById(id);
const esc=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const state={view:"home",section:"live",category:"all",query:"",catalog:{live:[],movies:[],series:[],liveCats:[],movieCats:[],seriesCats:[]},server:null,loading:false,player:null,playerEngine:null,episodeItems:[],playlists:[],activeId:null,favorites:[]};
function load(){
 let previous=null;try{previous=JSON.parse(localStorage.getItem(KEY)||"null")}catch{}
 if(previous){state.playlists=Array.isArray(previous.playlists)?previous.playlists:[];state.activeId=previous.activeId||state.playlists[0]?.id||null;state.favorites=Array.isArray(previous.favorites)?previous.favorites:[];return}
 try{
   const old=JSON.parse(localStorage.getItem(LEGACY)||"null");
   if(old&&Array.isArray(old.playlists)){
    state.playlists=old.playlists.map(p=>({id:p.id||uid(),type:p.type==="m3u"?"m3u":"xtream",name:p.name||"Playlist",baseUrl:p.baseUrl||"",username:p.username||"",password:p.password||"",m3uUrl:p.m3uUrl||""}));
    state.activeId=old.activePlaylistId||state.playlists[0]?.id||null;
   }
 }catch{}
 save();
}
function save(){try{localStorage.setItem(KEY,JSON.stringify({playlists:state.playlists,activeId:state.activeId,favorites:state.favorites}))}catch{}}
function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,7)}
function active(){return state.playlists.find(p=>p.id===state.activeId)||null}
function normalize(url){let value=String(url||"").trim().replace(/\/+$/,"");if(/^https:\/\/[^/]+:2052(?:\/|$)/i.test(value))value=value.replace(/^https:/i,"http:");return value}
function status(message,mode="normal"){const e=$("connectionStatus");e.className="status "+mode;e.innerHTML="<i></i>"+esc(message)}
function notify(message){$("toast").textContent=message;$("toast").classList.remove("hidden");clearTimeout(notify.timer);notify.timer=setTimeout(()=>$("toast").classList.add("hidden"),3800)}
function show(view){
 state.view=view;state.category="all";state.query="";render();
}
function iconFor(item){return item.kind==="live"?"◉":item.kind==="series"?"▤":"▶"}
function pageHead(title){return '<div class="section-head"><h1>'+esc(title)+'</h1><button class="back" data-route="home">← Home</button></div>'}
function tile(icon,title,desc,route,sm=false){return '<button class="tile '+(sm?"small":"")+'" data-route="'+route+'"><span class="tile-icon">'+icon+'</span><span><span class="tile-title">'+esc(title)+'</span><span class="tile-desc">'+esc(desc)+'</span></span><span class="tile-arrow">↗</span></button>'}
function home(){
 return '<div class="hero"><div><div class="eyebrow">Premium entertainment • MX TV</div><h1>Welcome to <span>MX TV.</span></h1><p>Your live channels, films and favorite shows in one elegant space. Inspired by the MazenmiXTream Android TV experience.</p></div><div class="hero-art"><b>MX</b><span>TV</span></div></div>'+
 '<div class="tile-grid">'+tile("◉","Live TV","Watch your channels live","live")+tile("▶","Movies","Explore your movie library","movies")+tile("▤","Series","Watch your favorite series","series")+'</div>'+
 '<div class="lower-grid">'+tile("◷","Catch Up","Replay supported programs","catchup",true)+tile("♡","Favorites","Your saved channels and titles","favorites",true)+tile("⚙","Settings","Playlists and preferences","settings",true)+'</div>';
}
function contentItems(){
 const items=state.view==="favorites"?[...state.catalog.live,...state.catalog.movies,...state.catalog.series].filter(it=>state.favorites.includes(it.key)):(state.catalog[state.view]||[]);
 const q=state.query.toLowerCase();
 return items.filter(it=>(state.category==="all"||String(it.cat)===state.category)&&(!q||it.name.toLowerCase().includes(q)));
}
function getCategories(){const keys={live:"liveCats",movies:"movieCats",series:"seriesCats"};return state.catalog[keys[state.view]]||[]}
function mediaCard(it){
 const favored=state.favorites.includes(it.key);
 return '<button class="media-card" data-item="'+esc(it.key)+'"><span class="poster">'+(it.logo?'<img src="'+esc(it.logo)+'" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()" alt="">':esc(iconFor(it)))+'</span><span class="card-copy"><strong>'+esc(it.name)+'</strong><span>'+esc(it.group||it.kind)+(favored?" • ★":"")+'</span></span></button>';
}
function section(){
 const titles={live:"Live TV",movies:"Movies",series:"Series",favorites:"Favorites"};
 const title=titles[state.view]||"Library";
 const it=contentItems();
 const cats=state.view==="favorites"?[]:getCategories();
 let shell=pageHead(title)+'<div class="layout"><nav class="sidebar"><button class="nav-button '+(state.view==="live"?"active":"")+'" data-route="live">◉ Live TV</button><button class="nav-button '+(state.view==="movies"?"active":"")+'" data-route="movies">▶ Movies</button><button class="nav-button '+(state.view==="series"?"active":"")+'" data-route="series">▤ Series</button><button class="nav-button '+(state.view==="favorites"?"active":"")+'" data-route="favorites">♡ Favorites</button><button class="nav-button" data-route="manage">⚙ Playlists</button></nav><div class="panel">';
 shell+='<div class="controls"><input id="search" type="search" placeholder="Search '+esc(title)+'" aria-label="Search channels and titles" value="'+esc(state.query)+'"><span style="font-size:12px;color:#a4a4aa">'+it.length.toLocaleString()+' items</span></div>';
 if(cats.length) shell+='<div class="controls" id="categoryList"><button class="pill '+(state.category==="all"?"active":"")+'" data-cat="all">All</button>'+cats.map(c=>'<button class="pill '+(state.category===String(c.id)?"active":"")+'" data-cat="'+esc(c.id)+'">'+esc(c.name)+'</button>').join("")+'</div>';
 if(state.loading) shell+='<div class="empty"><b>Loading your library…</b><span>Connecting to your IPTV provider</span></div>';
 else if(!active()) shell+='<div class="empty"><b>No IPTV playlist added</b><span>Connect your own Xtream or M3U account to begin.</span><button class="primary" data-route="manage">Add playlist</button></div>';
 else if(!it.length) shell+='<div class="empty"><b>No items available</b><span>'+(state.server?"Try another category or search.":"Select Refresh to load your library.")+'</span><button class="primary" data-refresh>Refresh library</button></div>';
 else shell+='<div class="media-grid">'+it.slice(0,400).map(mediaCard).join("")+'</div>'+(it.length>400?'<p class="notice">Showing the first 400 results. Use search to narrow your library.</p>':"");
 return shell+"</div></div>";
}
function manage(){
 const current=active();
 return pageHead("Manage Playlists")+'<div class="panel"><div class="section-head" style="margin:0 0 20px"><div><div class="eyebrow">Your IPTV accounts</div><p class="notice">Playlist credentials are stored in this browser. Use an account you are authorized to access.</p></div><button class="primary" data-new>+ Add playlist</button></div>'+
 (state.playlists.length?state.playlists.map(p=>'<div class="list-row"><div><strong>'+esc(p.name)+'</strong><div class="sub">'+esc(p.type==="xtream"?"Xtream Codes": "M3U playlist")+'</div></div><div class="row-actions"><button class="secondary" data-activate="'+esc(p.id)+'">'+(p.id===state.activeId?"Selected":"Use")+'</button><button class="secondary" data-edit="'+esc(p.id)+'">Edit</button><button class="secondary" data-remove="'+esc(p.id)+'">Delete</button></div></div>').join(""):'<div class="empty"><b>No playlists yet</b><span>Add your Xtream Codes account or M3U URL.</span></div>')+
 '<div class="dialog-actions"><button class="secondary" data-refresh>↻ Reload catalog</button></div></div>';
}
function settings(){return pageHead("Settings")+'<div class="panel"><h2>MX TV — Browser Edition</h2><p class="notice">This is an independent web implementation based on the Android app\'s premium MX TV design. The original APK is unchanged.</p><div class="list-row"><div><strong>Current playlist</strong><div class="sub">'+esc(active()?.name||"Not connected")+'</div></div><button class="secondary" data-route="manage">Manage</button></div><div class="list-row"><div><strong>Refresh IPTV library</strong><div class="sub">Download current channels, movies, series</div></div><button class="secondary" data-refresh>Refresh</button></div><div class="list-row"><div><strong>Clear web cache</strong><div class="sub">Your saved playlist settings remain</div></div><button class="secondary" data-clear>Clear</button></div><div class="error-note">IPTV API loading requires MX_IPTV_ALLOWED_ORIGINS to be configured for Cloudflare Pages. Media playback also depends on formats supported by your browser and provider.</div></div>'}
function render(){
 $("homeButton").setAttribute("aria-label","Return home");
 $("main").innerHTML=state.view==="home"?home():["live","movies","series","favorites"].includes(state.view)?section():state.view==="manage"?manage():state.view==="settings"?settings():pageHead("Catch Up")+'<div class="panel empty"><b>Catch Up</b><span>Catch-up playback appears when your provider exposes replay information.</span><button class="secondary" data-route="live">Browse channels</button></div>';
 const search=$("search");if(search){search.addEventListener("input",ev=>{const at=ev.target.selectionStart;state.query=ev.target.value;render();const n=$("search");n?.focus();try{n?.setSelectionRange(at,at)}catch{}})}
 const p=active();$("accountName").textContent=p?.name||"No playlist";
}
function openDialog(html){$("dialog").innerHTML='<div class="dialog-card">'+html+'</div>';$("dialog").classList.remove("hidden")}
function closeDialog(){$("dialog").classList.add("hidden");$("dialog").innerHTML=""}
function openPlaylistForm(id=null){
 const p=state.playlists.find(x=>x.id===id)||{id:uid(),type:"xtream",name:"",baseUrl:"",username:"",password:"",m3uUrl:""};
 openDialog('<div class="dialog-head"><h2>'+(id?"Edit playlist":"Add playlist")+'</h2><button class="dialog-close" data-close aria-label="Close">×</button></div><form id="playlistForm"><div class="form-grid"><div class="field"><label>Playlist name</label><input name="name" required value="'+esc(p.name)+'"></div><div class="field"><label>Type</label><select name="type"><option value="xtream" '+(p.type==="xtream"?"selected":"")+'>Xtream Codes</option><option value="m3u" '+(p.type==="m3u"?"selected":"")+'>M3U / M3U8</option></select></div></div><div id="xtreamFields"><div class="field"><label>Server URL</label><input name="baseUrl" placeholder="http://provider.example:2052" value="'+esc(p.baseUrl)+'"></div><div class="form-grid"><div class="field"><label>Username</label><input name="username" autocomplete="off" value="'+esc(p.username)+'"></div><div class="field"><label>Password</label><input type="password" name="password" autocomplete="off" value="'+esc(p.password)+'"></div></div></div><div class="field hidden" id="m3uFields"><label>Playlist URL</label><input name="m3uUrl" value="'+esc(p.m3uUrl)+'" placeholder="https://provider.example/playlist.m3u"></div><p class="notice">Use the provider\'s real HTTP/HTTPS address. The Cloudflare proxy handles HTTP sources.</p><div class="dialog-actions"><button type="button" class="secondary" data-close>Cancel</button><button class="primary" type="submit">Save playlist</button></div></form>');
 const frm=$("playlistForm");
 const type=frm.elements.type;function sync(){ $("xtreamFields").classList.toggle("hidden",type.value!=="xtream");$("m3uFields").classList.toggle("hidden",type.value!=="m3u") } type.onchange=sync;sync();
 frm.onsubmit=async ev=>{ev.preventDefault();const form=new FormData(frm);const record={id:p.id,type:form.get("type"),name:String(form.get("name")||"").trim(),baseUrl:normalize(form.get("baseUrl")),username:String(form.get("username")||"").trim(),password:String(form.get("password")||""),m3uUrl:normalize(form.get("m3uUrl"))};
 if(record.type==="xtream"&&(!/^https?:\/\//i.test(record.baseUrl)||!record.username||!record.password)){notify("Enter a valid server URL and credentials");return}
 if(record.type==="m3u"&&!/^https?:\/\//i.test(record.m3uUrl)){notify("Enter a valid M3U URL");return}
 const index=state.playlists.findIndex(x=>x.id===record.id);
 if(index>=0)state.playlists[index]=record;else state.playlists.push(record);
 state.activeId=record.id;save();closeDialog();show("home");await reload();};
}
function getUrl(base,params){const u=new URL(base.replace(/\/+$/,"")+"/player_api.php");for(const [k,v] of Object.entries(params))u.searchParams.set(k,String(v));return u.href}
async function proxy(url,{text=false,signal=null}={}){
 const response=await fetch("/api/iptv",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:normalize(url)}),signal});
 if(!response.ok){const detail=(await response.text()).slice(0,240);throw new Error(detail||"Server returned HTTP "+response.status)}
 return text?response.text():response.json();
}
function mediaUrl(original){return "/api/iptv?url="+encodeURIComponent(normalize(original))}
function catalogItem(row,kind,group,server){
 const id=kind==="series"?row.series_id:row.stream_id;
 const base=server?.stream_base||active()?.baseUrl||"";
 const ext=kind==="live"?(server?.formats?.includes("m3u8")?"m3u8":server?.formats?.includes("ts")?"ts":"ts"):(row.container_extension||"mp4");
 const route=kind==="live"?"live":kind==="movies"?"movie":"series";
 const p=active();
 let url="";
 if(kind!=="series"){
  url=row.direct_source&&/^https?:\/\//.test(row.direct_source)?row.direct_source:
      base+"/"+route+"/"+encodeURIComponent(p.username)+"/"+encodeURIComponent(p.password)+"/"+encodeURIComponent(String(id))+"."+ext;
 }
 return {key:kind+"-"+id,id,name:String(row.name||row.title||"Untitled"),kind,group:group||kind,cat:String(row.category_id||"0"),logo:String(row.stream_icon||row.stream_logo||row.cover||""),url,ext};
}
async function reload(){
 const p=active();
 if(!p){render();return}
 state.loading=true;state.server=null;state.catalog={live:[],movies:[],series:[],liveCats:[],movieCats:[],seriesCats:[]};status("Connecting…");render();
 try{
  if(p.type==="m3u"){
   const response=await proxy(p.m3uUrl,{text:true});
   const rows=response.split(/\r?\n/);let label="Channel",group="Live TV",logo="";
   if(!response.includes("#EXTM3U"))throw Error("Provider did not return a valid M3U playlist");
   for(const line of rows){
    if(line.startsWith("#EXTINF")){label=line.split(",").slice(1).join(",")||"Channel";group=line.match(/group-title="([^"]+)"/)?.[1]||"Live TV";logo=line.match(/tvg-logo="([^"]+)"/)?.[1]||""}
    else if(/^https?:\/\//i.test(line)){state.catalog.live.push({key:"live-"+state.catalog.live.length,id:state.catalog.live.length,name:label,kind:"live",cat:group,group,logo,url:line.trim()})}
   }
   state.catalog.liveCats=[...new Set(state.catalog.live.map(x=>x.group))].map(x=>({id:x,name:x}));
  }else{
   const credentials={username:p.username,password:p.password};
   const account=await proxy(getUrl(p.baseUrl,credentials));
   if(!account.user_info)throw Error("Xtream provider did not accept this login");
   const serverInfo=account.server_info||{};
   const streamHost=serverInfo.url||new URL(p.baseUrl).hostname;
   const proto=serverInfo.server_protocol||new URL(p.baseUrl).protocol.replace(":","");
   let streamBase=streamHost.includes("://")?streamHost:proto+"://"+streamHost;
   try{const u=new URL(streamBase);if(serverInfo.port&&!u.port)u.port=serverInfo.port;streamBase=normalize(u.origin)}catch{streamBase=p.baseUrl}
   const formats=Array.isArray(account.user_info.allowed_output_formats)?account.user_info.allowed_output_formats.map(String):[];
   state.server={stream_base:streamBase,formats,user:account.user_info};
   const lookups=[["get_live_categories","liveCats"],["get_vod_categories","movieCats"],["get_series_categories","seriesCats"],["get_live_streams","live"],["get_vod_streams","movies"],["get_series","series"]];
   for(const [action,target] of lookups){
    try{
      const rows=await proxy(getUrl(p.baseUrl,{...credentials,action}));
      if(!Array.isArray(rows))continue;
      if(target.endsWith("Cats"))state.catalog[target]=rows.map(c=>({id:String(c.category_id),name:c.category_name||"Other"}));
      else {
       const cats=Object.fromEntries(state.catalog[target==="live"?"liveCats":target==="movies"?"movieCats":"seriesCats"].map(c=>[c.id,c.name]));
       state.catalog[target]=rows.map(row=>catalogItem(row,target,cats[String(row.category_id)]||target,state.server));
      }
      status("Loaded "+state.catalog.live.length+" channels");
    }catch(e){console.warn("MX TV could not load "+target+": "+e.message)}
   }
   if(![state.catalog.live,state.catalog.movies,state.catalog.series].some(x=>x.length))throw Error("No library received. Check Cloudflare allowlist and Xtream settings.");
  }
  status("Connected","ready");notify("Playlist library loaded");render();
 }catch(error){
  console.warn("MX TV connection error:",error.message);
  status("Connection unavailable","error");render();$("main").insertAdjacentHTML("afterbegin",'<div class="error-note"><b>Playlist did not load:</b> '+esc(error.message)+' <button class="secondary" data-refresh>Retry</button></div>');
 }finally{state.loading=false}
}

async function openSeries(item){
 const playlist=active();
 if(!playlist || playlist.type!=="xtream"){notify("No Xtream account selected");return}
 openDialog('<div class="dialog-head"><h2>'+esc(item.name)+'</h2><button class="dialog-close" data-close>×</button></div><div class="empty"><b>Loading episodes…</b></div>');
 try{
  const result=await proxy(getUrl(playlist.baseUrl,{username:playlist.username,password:playlist.password,action:"get_series_info",series_id:item.id}));
  const groups=result?.episodes&&typeof result.episodes==="object"?result.episodes:{};
  const found=[];
  for(const [season,episodes] of Object.entries(groups)){
   if(!Array.isArray(episodes))continue;
   for(const ep of episodes){
    const id=ep.id||ep.stream_id;
    if(!id)continue;
    const ext=String(ep.container_extension||"mp4").replace(/[^a-z0-9]/gi,"")||"mp4";
    const base=state.server?.stream_base||playlist.baseUrl;
    const url=/^https?:\/\//i.test(ep.direct_source||"")?ep.direct_source:base+"/series/"+encodeURIComponent(playlist.username)+"/"+encodeURIComponent(playlist.password)+"/"+encodeURIComponent(String(id))+"."+ext;
    found.push({key:"episode-"+String(id),kind:"episode",id,name:ep.title||item.name+" - Episode "+String(ep.episode_num||found.length+1),cat:String(season),group:"Season "+season,url,logo:item.logo,ext});
   }
  }
  state.episodeItems=found;
  if(!found.length)throw Error("Provider did not return episodes for this series");
  openDialog('<div class="dialog-head"><h2>'+esc(item.name)+'</h2><button class="dialog-close" data-close>×</button></div><p class="notice">'+found.length+' episodes available</p><div style="max-height:55vh;overflow:auto">'+found.slice(0,500).map(ep=>'<button class="list-row" style="width:100%;color:white;text-align:left" data-episode="'+esc(ep.key)+'"><span><strong>'+esc(ep.name)+'</strong><span class="sub" style="display:block">'+esc(ep.group)+'</span></span><span>▶</span></button>').join("")+'</div>');
 }catch(error){openDialog('<div class="dialog-head"><h2>'+esc(item.name)+'</h2><button class="dialog-close" data-close>×</button></div><div class="error-note">Could not load episodes: '+esc(error.message)+'</div>')}
}

function openPlayer(it){
 $("playerName").textContent=it.name;$("playerDetails").textContent=it.group;
 $("playerError").textContent="";$("player").classList.remove("hidden");
 state.player=it;const video=$("video");video.pause();video.removeAttribute("src");video.load();
 if(!it.url){$("playerError").textContent="This series needs an episode selection from the server.";return}
 const src=mediaUrl(it.url);
 try{
  if(/\.m3u8(?:\?|$)/i.test(it.url)&&window.Hls?.isSupported()){
    const hls=new Hls({enableWorker:true,lowLatencyMode:true,xhrSetup(xhr,url){xhr.open("GET",url.startsWith(location.origin)?url:mediaUrl(url),true)},fetchSetup(ctx,params){return new Request(ctx.url.startsWith(location.origin)?ctx.url:mediaUrl(ctx.url),params)}});
    hls.loadSource(src);hls.attachMedia(video);state.playerEngine=hls;
    hls.on(Hls.Events.MANIFEST_PARSED,()=>video.play().catch(()=>{}));hls.on(Hls.Events.ERROR,(_,data)=>{if(data.fatal)$("playerError").textContent="HLS playback failed: "+data.details});
  }else if(/\.ts(?:\?|$)/i.test(it.url)&&window.mpegts?.isSupported()){
    const engine=window.mpegts.createPlayer({type:"mpegts",isLive:it.kind==="live",url:src},{enableWorker:true,lazyLoad:false});
    engine.attachMediaElement(video);engine.load();engine.play();state.playerEngine=engine;
  }else {video.src=src;video.play().catch(()=>{});}
 }catch(error){$("playerError").textContent=error.message}
}
function stopPlayer(){
 if(state.playerEngine){try{state.playerEngine.destroy()}catch{}state.playerEngine=null}
 const video=$("video");video.pause();video.removeAttribute("src");video.load();$("player").classList.add("hidden");state.player=null;
}
document.addEventListener("click",ev=>{
 const target=ev.target.closest("button");if(!target)return;
 if(target.id==="homeButton"||target.dataset.route){show(target.dataset.route||"home");return}
 if(target.dataset.close!==undefined){closeDialog();return}
 if(target.dataset.new!==undefined){openPlaylistForm();return}
 if(target.dataset.edit){openPlaylistForm(target.dataset.edit);return}
 if(target.dataset.activate){state.activeId=target.dataset.activate;save();show("home");reload();return}
 if(target.dataset.remove){if(confirm("Remove this playlist from this browser?")){state.playlists=state.playlists.filter(p=>p.id!==target.dataset.remove);if(state.activeId===target.dataset.remove)state.activeId=state.playlists[0]?.id||null;save();show("manage")}return}
 if(target.dataset.refresh!==undefined){reload();return}
 if(target.dataset.clear!==undefined){state.catalog={live:[],movies:[],series:[],liveCats:[],movieCats:[],seriesCats:[]};render();notify("Web catalog cleared");return}
 if(target.dataset.cat){state.category=target.dataset.cat;render();return}
 if(target.dataset.item){const it=[...state.catalog.live,...state.catalog.movies,...state.catalog.series].find(x=>x.key===target.dataset.item);if(it){if(it.kind==="series")openSeries(it);else openPlayer(it)}return}
 if(target.dataset.episode){const ep=state.episodeItems.find(x=>x.key===target.dataset.episode);if(ep){closeDialog();openPlayer(ep)}return}
 if(target.id==="closePlayer"){stopPlayer();return}
 if(target.id==="favoritePlayer"){const key=state.player?.key;if(!key)return;state.favorites=state.favorites.includes(key)?state.favorites.filter(x=>x!==key):[...state.favorites,key];save();notify("Favorites updated");return}
});
document.addEventListener("keydown",ev=>{if(ev.key==="Escape"){if(!$("player").classList.contains("hidden"))stopPlayer();else closeDialog()}});
$("video").addEventListener("error",()=>{$("playerError").textContent="This stream is unavailable in the browser. Check formats and Cloudflare proxy."});
load();render();
})();
