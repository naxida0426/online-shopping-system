(() => {
  const canvas=document.getElementById("sales-chart"), dataNode=document.getElementById("sales-data");
  if(!canvas||!dataNode||typeof Chart==="undefined")return;
  const data=JSON.parse(dataNode.textContent);
  new Chart(canvas,{type:"bar",data:{labels:data.labels,datasets:[{label:"模拟支付销售额（元）",data:data.sales.map(Number),backgroundColor:"#52735e",borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,scales:{y:{beginAtZero:true}},plugins:{legend:{display:false}}}});
  canvas.dataset.ready="true";
})();
