import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { Anchor, Place, navigationUrl } from '../../shared/model';
export function InteractiveMap({anchor,places,selected,onSelect,user}:{anchor:Anchor;places:Place[];selected:Place|null;onSelect:(p:Place)=>void;user:{latitude:number;longitude:number}|null}) {
 const container=useRef<HTMLDivElement>(null),map=useRef<L.Map|null>(null),layer=useRef<L.LayerGroup|null>(null),markers=useRef(new Map<string,L.Marker>());
 const [tileError,setTileError]=useState(false);const onSelectRef=useRef(onSelect);onSelectRef.current=onSelect;
 useEffect(()=>{
  if(!container.current)return;const instance=L.map(container.current,{center:[anchor.latitude,anchor.longitude],zoom:14,zoomControl:false,zoomAnimation:false,fadeAnimation:false,markerZoomAnimation:false});L.control.zoom({zoomInTitle:'放大地圖',zoomOutTitle:'縮小地圖'}).addTo(instance);map.current=instance;layer.current=L.layerGroup().addTo(instance);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).on('tileerror',()=>setTileError(true)).addTo(instance);
  const observer=new ResizeObserver(()=>{if(map.current===instance)instance.invalidateSize();});observer.observe(container.current);
  return ()=>{observer.disconnect();map.current=null;instance.stop();instance.closePopup();instance.remove();layer.current=null;markers.current.clear();};
 },[]);
 useEffect(()=>{
  if(!map.current||!layer.current)return;const group=layer.current;group.clearLayers();markers.current.clear();
  const icon=(symbol:string,cls:string)=>L.divIcon({className:'',html:`<span class="map-pin ${cls}">${symbol}</span>`,iconSize:[32,32],iconAnchor:[16,16]});
  const center=document.createElement('div');center.textContent=`搜尋中心：${anchor.displayName}`;
  L.marker([anchor.latitude,anchor.longitude],{icon:icon('◎','center')}).bindPopup(center).addTo(group);
  if(user)L.marker([user.latitude,user.longitude],{icon:icon('●','user')}).bindPopup('你的 GPS 位置').addTo(group);
  for(const p of places){
   const popup=document.createElement('div');const title=document.createElement('strong');title.textContent=p.name;popup.append(title,document.createElement('br'));
   const category=document.createElement('span');category.textContent=`${p.category} · ${(p.distance/1000).toFixed(2)} km`;popup.append(category,document.createElement('br'));
   const nav=document.createElement('a');nav.textContent='Google Maps 導航';nav.href=navigationUrl(p,user);nav.target='_blank';nav.rel='noopener noreferrer';popup.append(nav);
   const symbol=p.category==='咖啡廳'?'☕':p.category==='甜點'?'🍰':['餐廳','小吃'].includes(p.category)?'🍜':'📍';
   const marker=L.marker([p.latitude,p.longitude],{icon:icon(symbol,p.id===selected?.id?'selected':'')}).bindPopup(popup).on('click',()=>onSelectRef.current(p)).addTo(group);markers.current.set(p.id,marker);
  }
  map.current.setView([anchor.latitude,anchor.longitude],14,{animate:false});
 },[anchor,places,user]);
 useEffect(()=>{if(!selected||!map.current)return;const marker=markers.current.get(selected.id);if(marker){map.current.setView([selected.latitude,selected.longitude],16,{animate:false});marker.openPopup();}},[selected,places]);
 return <section aria-label="探索地圖" className="relative overflow-hidden rounded-2xl border border-slate-800"><div ref={container} className="h-[540px] w-full" data-testid="map"/><span className="absolute right-3 top-3 z-[400] rounded-lg bg-slate-950/90 px-3 py-2 text-xs text-emerald-300">{places.length} 個地點 · 地圖與列表同步</span>{tileError&&<div role="status" className="absolute bottom-8 left-3 right-3 z-[400] rounded bg-slate-950/95 p-2 text-xs">部分圖磚無法載入；仍可使用地點列表與導航。</div>}</section>;
}
