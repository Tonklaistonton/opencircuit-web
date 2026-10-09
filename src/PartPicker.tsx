import {useEffect, useMemo, useRef, useState} from 'react';
import {LIBRARY_CATEGORIES, PART_LIBRARY, searchLibrary} from './circuit/catalog.ts';
import type {LibraryPart} from './circuit/catalog.ts';
import {LibrarySymbol} from './LibrarySymbol.tsx';

export function PartPicker({language,onSelect,onClose}:{
  language:'th'|'en';onSelect:(part:LibraryPart)=>void;onClose:()=>void;
}) {
  const th=language==='th';
  const [query,setQuery]=useState('');
  const [category,setCategory]=useState('all');
  const [favorites,setFavorites]=useState<string[]>(()=>{
    try{const x=JSON.parse(localStorage.getItem('opencircuit-favorite-parts')??'[]');
      return Array.isArray(x)?x.filter((id):id is string=>typeof id==='string'):[];}
    catch{return [];}
  });
  const [onlyFavorites,setOnlyFavorites]=useState(false);
  const input=useRef<HTMLInputElement>(null);
  useEffect(()=>{
    input.current?.focus();
    function key(event:KeyboardEvent){if(event.key==='Escape'){event.preventDefault();onClose();}}
    window.addEventListener('keydown',key);
    return ()=>window.removeEventListener('keydown',key);
  },[onClose]);
  const results=useMemo(()=>searchLibrary(query,category).filter((part)=>
    !onlyFavorites || favorites.includes(part.id)),[query,category,onlyFavorites,favorites]);
  function toggleFavorite(id:string){
    setFavorites((current)=>{
      const next=current.includes(id)?current.filter((item)=>item!==id):[...current,id];
      localStorage.setItem('opencircuit-favorite-parts',JSON.stringify(next));
      return next;
    });
  }
  return <div className="part-picker-backdrop" onPointerDown={(event)=>{
    if(event.target===event.currentTarget)onClose();
  }}>
    <section role="dialog" aria-modal="true" aria-labelledby="part-picker-heading" className="part-picker">
      <div className="part-picker-header">
        <div><h2 id="part-picker-heading">{th?'เลือกอุปกรณ์ (Place Part)':'Place Part — Component Library'}</h2>
          <p>{th?'ค้นหาอุปกรณ์ วางบนแบบวงจร และเดินสายต่อได้จริง':'Search components, place on schematic, and wire the pins'}</p>
        </div>
        <button type="button" onClick={onClose} aria-label={th?'ปิด':'Close'}>✕</button>
      </div>
      <div className="part-picker-search">
        <input ref={input} type="search" value={query} onChange={(e)=>setQuery(e.target.value)}
          placeholder={th?'ค้นหาชื่ออุปกรณ์ เช่น MOSFET, LED, ตัวต้านทาน, Arduino...':'Search e.g. MOSFET, LED, resistor, sensor...'}
          aria-label={th?'ค้นหาอุปกรณ์':'Search library'}/>
        <button onClick={()=>setOnlyFavorites((v)=>!v)} aria-pressed={onlyFavorites}
          className={onlyFavorites?'active':''}>{th?'★ รายการโปรด':'★ Favorites'}</button>
      </div>
      <div className="part-picker-body">
        <aside className="part-picker-categories" aria-label={th?'หมวดหมู่อุปกรณ์':'Component categories'}>
          <button className={category==='all'?'active':''} onClick={()=>setCategory('all')}>
            {th?'ทั้งหมด':'All components'} <span>{PART_LIBRARY.length}</span>
          </button>
          {LIBRARY_CATEGORIES.map((item)=>{
            const count=PART_LIBRARY.filter((part)=>part.category===item.id).length;
            return <button key={item.id} className={category===item.id?'active':''}
              onClick={()=>setCategory(item.id)}>{th?item.nameTh:item.name}<span>{count}</span></button>;
          })}
        </aside>
        <div className="part-picker-results">
          <div className="part-picker-count">
            <strong>{th?'พบ':'Results'} {results.length} {th?'รายการ':'parts'}</strong>
            <span>{th?'คลิก “เลือกวาง” แล้วคลิกบนกระดาษ':'Click Place, then click the drawing sheet'}</span>
          </div>
          <div className="part-picker-grid">
            {results.map((part)=><article key={part.id} className="part-picker-card">
              <div className="part-picker-preview">
                <svg viewBox="-100 -100 200 200" role="img" aria-label={th?part.nameTh:part.name}>
                  <g color="currentColor"><LibrarySymbol part={part}/></g>
                  {part.pins.map((pin,i)=><circle key={i} cx={pin.x} cy={pin.y} r="4" fill="#22b8aa"/>)}
                </svg>
              </div>
              <div className="part-picker-info">
                <div className="part-picker-name">{th?part.nameTh:part.name}</div>
                <small>{th?part.name:part.nameTh}</small>
                <p title={th?part.descriptionTh:part.description}>{th?part.descriptionTh:part.description}</p>
                <div className="part-picker-meta">
                  <span>{part.pins.length} {th?'ขา':'pins'}</span>
                  <span className={part.simulation==='dc'?'sim-ready':'sim-schematic'}>
                    {part.simulation==='dc'?(th?'● DC จำลองได้':'● DC ready'):
                      (th?'○ วาดวงจร':'○ schematic only')}
                  </span>
                </div>
                <div className="part-picker-actions">
                  <button className="part-picker-place" onClick={()=>onSelect(part)}>
                    {th?'＋ เลือกวาง':'＋ Place'}
                  </button>
                  <button className={favorites.includes(part.id)?'part-picker-favorite active':'part-picker-favorite'}
                    onClick={()=>toggleFavorite(part.id)} aria-label={th?'เพิ่มหรือลบรายการโปรด':'Toggle favorite'}
                    title={th?'รายการโปรด':'Favorite'}>{favorites.includes(part.id)?'★':'☆'}</button>
                </div>
              </div>
            </article>)}
          </div>
          {results.length===0&&<div className="part-picker-empty">
            <strong>{th?'ไม่พบอุปกรณ์ที่ค้นหา':'No parts found'}</strong>
            <p>{th?'ลองใช้ชื่อทั่วไปหรือค้นหาหมวดหมู่อื่น':'Try another name or category'}</p>
            <button onClick={()=>{setQuery('');setCategory('all');setOnlyFavorites(false);}}>
              {th?'ล้างตัวกรอง':'Clear filters'}
            </button>
          </div>}
        </div>
      </div>
      <div className="part-picker-footer">
        {th?'หมายเหตุ: สัญลักษณ์หลายรายการยังไม่รองรับ SPICE หรือมีขาจริงที่ผ่านการยืนยัน โปรดตรวจ Datasheet ก่อนออกแบบฮาร์ดแวร์':
          'Note: Many symbols are schematic-only and pinouts are generic. Always verify the datasheet before PCB design.'}
      </div>
    </section>
  </div>;
}
