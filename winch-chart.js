(function(root) {
  const colors={up:'#7c3aed',down:'#d97706'};
  function signals(history,start,end) {
    return (Array.isArray(history)?history:[]).filter(event=>
      event.status==='sent' && ['up','down'].includes(event.action) &&
      Number.isFinite(event.at) && event.at>=start && event.at<=end
    ).sort((a,b)=>a.at-b.at);
  }
  function label(event) {
    const time=new Date(event.at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
    return `${time} · ${event.mode==='auto'?'자동':'수동'} ${event.action==='up'?'▲ 올림':'▼ 내림'} 신호 요청`;
  }
  function visible(chart,options) {
    return signals(options.history,chart.scales.x.min,chart.scales.x.max);
  }
  const plugin={
    id:'winchSignals',
    descriptors:{_scriptable:false,_indexable:false},
    beforeDatasetsDraw(chart,args,options) {
      const {ctx,chartArea:area,scales:{x}}=chart;
      if(!area)return;
      ctx.save();ctx.beginPath();ctx.rect(area.left,area.top,area.right-area.left,area.bottom-area.top);ctx.clip();
      for(const event of visible(chart,options)) {
        const pixel=x.getPixelForValue(event.at);
        ctx.strokeStyle=colors[event.action];ctx.lineWidth=1.5;ctx.setLineDash(event.action==='down'?[4,3]:[]);
        ctx.beginPath();ctx.moveTo(pixel,area.top);ctx.lineTo(pixel,area.bottom);ctx.stroke();
        ctx.fillStyle=colors[event.action];ctx.font='bold 11px sans-serif';ctx.textAlign='center';ctx.textBaseline='top';
        ctx.fillText(event.action==='up'?'▲':'▼',pixel,area.top+2);
      }
      ctx.restore();
    },
    afterEvent(chart,args,options) {
      const event=args.event, area=chart.chartArea;
      let selected=null, distance=9;
      if(event.type!=='mouseout'&&area&&event.x>=area.left&&event.x<=area.right&&event.y>=area.top&&event.y<=area.bottom) {
        for(const signal of visible(chart,options)) {
          const d=Math.abs(chart.scales.x.getPixelForValue(signal.at)-event.x);
          if(d<distance){selected=signal;distance=d;}
        }
      }
      const previous=chart.$winchSignal;
      chart.$winchSignal=selected;
      if(previous?.at!==selected?.at || previous?.action!==selected?.action)args.changed=true;
    },
    afterDraw(chart,args,options) {
      const event=chart.$winchSignal;
      if(!event||!visible(chart,options).some(item=>item.at===event.at && item.action===event.action))return;
      const {ctx,chartArea:area}=chart;
      const text=label(event);
      ctx.save();ctx.font='bold 11px sans-serif';
      const width=Math.min(ctx.measureText(text).width+16,area.right-area.left);
      ctx.fillStyle='rgba(255,255,255,0.96)';ctx.fillRect(area.left,area.bottom-28,width,24);
      ctx.fillStyle=colors[event.action];ctx.textAlign='left';ctx.textBaseline='middle';
      ctx.fillText(text,area.left+8,area.bottom-16,Math.max(1,width-16));ctx.restore();
    }
  };
  const api={signals,label,plugin};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.FarmWinchChart=api;
})(typeof window==='object'?window:globalThis);
