const $ = s => document.querySelector(s);
let channels = [], allVideos = [], activeSubject = "الكل", activeChannel = null;
const fmtDate = value => value ? new Intl.DateTimeFormat("ar-IQ",{dateStyle:"medium"}).format(new Date(value)) : "";
const fmtDuration = iso => {
  if (!iso) return "";
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return "";
  const h=+(m[1]||0), min=+(m[2]||0), sec=+(m[3]||0);
  return h ? `${h}:${String(min).padStart(2,"0")}:${String(sec).padStart(2,"0")}` : `${min}:${String(sec).padStart(2,"0")}`;
};
function toast(message){const el=$("#toast");el.textContent=message;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),2800)}
function esc(s=""){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
async function api(url){const r=await fetch(url);const data=await r.json();if(!r.ok)throw new Error(data.error||"تعذر تحميل البيانات");return data}
function renderTeachers(){
 const list=channels.filter(c=>activeSubject==="الكل"||c.subject===activeSubject||c.subject==="عام");
 $("#teacherCount").textContent=`${list.length} قناة`;
 $("#teachers").innerHTML=list.length?list.map(c=>`<button class="teacher" data-channel="${esc(c.id)}">
 ${c.avatar?`<img class="avatar" src="${esc(c.avatar)}" alt="">`:`<span class="avatar avatar-fallback">${esc((c.name||"م").slice(0,1))}</span>`}
 <span class="teacher-name">${esc(c.name)}</span><span class="teacher-sub">${esc(c.subject||"مدرس")}</span></button>`).join(""):`<div class="empty">لا توجد قنوات بهذا القسم حالياً</div>`;
 document.querySelectorAll("[data-channel]").forEach(b=>b.addEventListener("click",()=>loadChannel(b.dataset.channel)));
}
function renderVideos(list){
 $("#videos").innerHTML=list.length?list.map(v=>`<article class="video-card" data-video="${esc(v.id)}">
 <div class="thumb-wrap"><img class="thumb" loading="lazy" src="${esc(v.thumbnail)}" alt=""><span class="duration">${fmtDuration(v.duration)}</span></div>
 <div class="video-info">${v.channel?.avatar?`<img class="mini-avatar" src="${esc(v.channel.avatar)}" alt="">`:""}
 <div><h3 class="video-title">${esc(v.title)}</h3><p class="video-channel">${esc(v.channel?.name||"")}</p><p class="video-date">${fmtDate(v.publishedAt)}</p></div></div></article>`).join(""):`<div class="empty">لا توجد محاضرات للعرض حالياً</div>`;
 document.querySelectorAll("[data-video]").forEach(card=>card.addEventListener("click",()=>openVideo(allVideos.find(v=>v.id===card.dataset.video))));
}
function openVideo(v){
 if(!v)return;
 $("#player").innerHTML=`<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.id)}?autoplay=1&rel=0" title="${esc(v.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`;
 $("#modalTitle").textContent=v.title;$("#modalMeta").textContent=`${v.channel?.name||""} · ${fmtDate(v.publishedAt)}`;
 $("#youtubeLink").href=v.url;$("#videoModal").classList.add("open");$("#videoModal").setAttribute("aria-hidden","false");
}
function closeModal(){$("#player").innerHTML="";$("#videoModal").classList.remove("open");$("#videoModal").setAttribute("aria-hidden","true")}
async function loadChannel(id){
 const ch=channels.find(c=>c.id===id);if(!ch)return;
 activeChannel=ch;$("#feedTitle").textContent=`محاضرات ${ch.name}`;$("#videos").innerHTML='<div class="loading">جارِ تحميل محاضرات القناة...</div>';
 try{const data=await api(`/api/channels/${encodeURIComponent(id)}/videos`);allVideos=data.videos.map(v=>({...v,channel:ch}));renderVideos(allVideos);$("#homeBtn").textContent="العودة للرئيسية"}
 catch(e){$("#videos").innerHTML=`<div class="empty">${esc(e.message)}</div>`}
}
async function init(){
 try{
  const data=await api("/api/channels");channels=data.channels||[];renderTeachers();
  const good=channels.filter(c=>c.id&&!c.id.startsWith("pending-"));
  if(!good.length){$("#videos").innerHTML='<div class="empty">تم تجهيز الواجهة. أضف مفتاح YouTube API للسيرفر حتى تظهر المحاضرات الحقيقية.</div>';return}
  const results=await Promise.allSettled(good.map(async c=>{const d=await api(`/api/channels/${encodeURIComponent(c.id)}/videos`);return d.videos.map(v=>({...v,channel:c}))}));
  allVideos=results.filter(r=>r.status==="fulfilled").flatMap(r=>r.value).sort((a,b)=>new Date(b.publishedAt)-new Date(a.publishedAt));
  renderVideos(allVideos);
  if(!allVideos.length)$("#videos").innerHTML='<div class="empty">لم تظهر فيديوهات بعد. تحقق من إعداد مفتاح API.</div>';
 }catch(e){$("#teachers").innerHTML=`<div class="empty">${esc(e.message)}</div>`;$("#videos").innerHTML='<div class="empty">تعذر الاتصال بالسيرفر.</div>'}
}
$("#subjects").addEventListener("click",e=>{const b=e.target.closest("[data-subject]");if(!b)return;activeSubject=b.dataset.subject;document.querySelectorAll(".chip").forEach(x=>x.classList.toggle("active",x===b));renderTeachers();});
$("#searchInput").addEventListener("input",e=>{const q=e.target.value.trim().toLowerCase();renderVideos(allVideos.filter(v=>`${v.title} ${v.channel?.name||""}`.toLowerCase().includes(q)))});
$("#homeBtn").addEventListener("click",()=>{activeChannel=null;$("#feedTitle").textContent="أحدث المحاضرات";$("#homeBtn").textContent="عرض الكل";renderVideos(allVideos)});
document.querySelectorAll("[data-close]").forEach(x=>x.addEventListener("click",closeModal));
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeModal()});
init();