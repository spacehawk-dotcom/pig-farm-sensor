export function createHistoryCharts() {
 const C=window.VentCore, $=id=>document.getElementById(id);
 const fmt=n=>Number(n).toLocaleString('ko-KR',{maximumFractionDigits:1});
 const formatTime=time=>C.toKoreanInput(time).replace('T',' ');
 let timeSeriesData=[],activeRange,tempChartInstance,ventChartInstance,flowChartInstance;
        function timeScale() {
            const unit = activeRange.end - activeRange.start >= 3 * C.DAY ? 'day' : 'hour';
            return {
                min: activeRange.start, max: activeRange.end, type: 'time',
                time: { unit, displayFormats: {hour:'MM/dd HH:mm',day:'MM/dd'}, tooltipFormat:'MM/dd HH:mm' },
                grid: { display:false },
                ticks: {color:'#64748b',maxRotation:0,maxTicksLimit:10,callback:value=>unit==='day'?formatTime(Number(value)).slice(5,10):formatTime(Number(value)).slice(5)}
            };
        }

        function updateCharts(s, ventDataArray) {
            const ctxTemp = document.getElementById('tempChart').getContext('2d');
            const ctxVent = document.getElementById('ventChart').getContext('2d');

            const dataInTemp = [], dataOutTemp = [], dataTargetTemp = [];
            const dataV1 = [], dataV2 = [], dataV3 = [], dataV4 = [];

            timeSeriesData.forEach((point, i) => {
                if (i && point.time - timeSeriesData[i-1].time > 1800000) {
                    for (const series of [dataInTemp,dataOutTemp,dataTargetTemp,dataV1,dataV2,dataV3,dataV4]) series.push({ x: timeSeriesData[i-1].time + 1, y: null });
                }
                dataInTemp.push({ x: point.time, y: point.inTemp });
                dataOutTemp.push({ x: point.time, y: point.outTemp });
                dataTargetTemp.push({ x: point.time, y: s.g1.t });

                dataV1.push({ x: point.time, y: ventDataArray[i].v1 });
                dataV2.push({ x: point.time, y: ventDataArray[i].v2 });
                dataV3.push({ x: point.time, y: ventDataArray[i].v3 });
                dataV4.push({ x: point.time, y: ventDataArray[i].v4 });
            });

            const xScaleOptions = timeScale();

            const tooltipOptions = { backgroundColor: 'rgba(255, 255, 255, 0.95)', titleColor: '#1e293b', bodyColor: '#334155', borderColor: '#cbd5e1', borderWidth: 1, padding: 10, usePointStyle: true };

            if (tempChartInstance) tempChartInstance.destroy();
            tempChartInstance = new Chart(ctxTemp, {
                type: 'line',
                data: {
                    datasets: [
                        { label: '🔥실내 온도', data: dataInTemp, borderColor: '#ef4444', borderWidth: 2, pointRadius: timeSeriesData.length === 1 ? 3 : 0, pointHoverRadius: 5, tension: 0, z: 10 },
                        { label: '🎯1그룹 설정온도', data: dataTargetTemp, borderColor: '#22c55e', borderWidth: 1.5, borderDash: [5, 5], pointRadius: timeSeriesData.length === 1 ? 3 : 0, tension: 0 },
                        { label: '❄️외기 온도', data: dataOutTemp, borderColor: '#94a3b8', borderWidth: 1.5, borderDash: [3, 3], pointRadius: timeSeriesData.length === 1 ? 3 : 0, tension: 0 }
                    ]
                },
                options: {
                    responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
                    scales: { x: xScaleOptions, y: { type: 'linear', position: 'left', title: { display: false }, ticks: { color: '#ef4444', callback: val => val + '℃' } } },
                    plugins: { legend: { position: 'top', labels: { usePointStyle: true, boxWidth: 8, font: {size: 11} } }, tooltip: { ...tooltipOptions, callbacks: { title:items=>items.length?formatTime(items[0].parsed.x)+' KST':'', label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}℃` } } }
                }
            });

            if (ventChartInstance) ventChartInstance.destroy();
            ventChartInstance = new Chart(ctxVent, {
                type: 'line',
                data: {
                    datasets: [
                        { label: '1그룹(500x2)', data: dataV1, borderColor: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.1)', borderWidth: 1.5, fill: false, pointRadius: timeSeriesData.length === 1 ? 3 : 0, tension: 0, stepped: 'before' },
                        { label: '2그룹(500x3)', data: dataV2, borderColor: '#14b8a6', backgroundColor: 'rgba(20, 184, 166, 0.15)', borderWidth: 1.5, fill: false, pointRadius: timeSeriesData.length === 1 ? 3 : 0, tension: 0, stepped: 'before' },
                        { label: '3그룹(800x2)', data: dataV3, borderColor: '#f97316', backgroundColor: 'rgba(249, 115, 22, 0.2)', borderWidth: 1.5, fill: false, pointRadius: timeSeriesData.length === 1 ? 3 : 0, tension: 0, stepped: 'before' },
                        { label: '4그룹(800x2)', data: dataV4, borderColor: '#f43f5e', backgroundColor: 'rgba(244, 63, 94, 0.2)', borderWidth: 1.5, fill: false, pointRadius: timeSeriesData.length === 1 ? 3 : 0, tension: 0, stepped: 'before' }
                    ]
                },
                options: {
                    responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
                    scales: { x: xScaleOptions, y: { type: 'linear', position: 'left', min: 0, max: 100, ticks: { color: '#475569', stepSize: 25, callback: val => val + '%' } } },
                    plugins: { legend: { position: 'top', labels: { usePointStyle: true, boxWidth: 8, font: {size: 11} } }, tooltip: { ...tooltipOptions, callbacks: { title:items=>items.length?formatTime(items[0].parsed.x)+' KST':'', label: ctx => `${ctx.dataset.label}: ${Math.round(ctx.parsed.y)}%` } } }
                }
            });
        }

        function drawFlow(vent, req) {
            if (flowChartInstance) flowChartInstance.destroy();
            const points = [];
            timeSeriesData.forEach((p,i) => {
                if (i && p.time-timeSeriesData[i-1].time>1800000) points.push({x:timeSeriesData[i-1].time+1,y:null});
                points.push({x:p.time,y:C.flow(vent[i])});
            });
            const datasets = [{label:'추정 합계 풍량',data:points,borderColor:'#2563eb',pointRadius:timeSeriesData.length === 1 ? 3 : 0,borderWidth:2,stepped:'before'}];
            if (req) for (const [key,label,color] of [['min','최소 요구량','#16a34a'],['max','고온기 최대 요구량','#f97316']]) datasets.push({label,data:[{x:activeRange.start,y:req[key]},{x:activeRange.end,y:req[key]}],borderColor:color,borderDash:[5,5],pointRadius:0,borderWidth:1.5});
            flowChartInstance = new Chart($('flowChart'), {
                type:'line', data:{datasets},
                options:{
                    responsive:true, maintainAspectRatio:false, animation:false,
                    scales:{
                        x:timeScale(),
                        y:{beginAtZero:true,ticks:{callback:n=>fmt(n)}}
                    },
                    plugins:{legend:{labels:{boxWidth:10,font:{size:11}}},tooltip:{callbacks:{title:items=>items.length?formatTime(items[0].parsed.x)+' KST':''}}}
                }
            });
        }

 return {render(raw,room,opt,weight,count,range) {
  activeRange=range;timeSeriesData=C.normalize(raw,room,range);
  const settings=Object.fromEntries(['f500_1','f500_2','f800_1','f800_2'].map((key,i)=>['g'+(i+1),{...opt[key],p:opt[key].diff}]));
  const vent=timeSeriesData.map(p=>C.rates(p.inTemp,settings));
  updateCharts(settings,vent);drawFlow(vent,C.requirements(weight,count,'nias'));
  $('history-chart-status').textContent=`${room.replace('_',' ')} · 최근 24시간 ${timeSeriesData.length}건 · 현재 저장 설정을 전체 기간에 적용한 계산값입니다. 실제 팬 가동 기록이 아닙니다. 30분 초과 공백은 연결하지 않습니다.`;
 }};
}
