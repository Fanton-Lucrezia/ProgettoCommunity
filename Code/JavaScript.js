document.getElementById("csvFile").addEventListener("change", function(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();

  reader.onload = function(e) {
    const text = e.target.result;

    // Divide in righe e poi in celle (CSV semplice separato da virgole)
    const rows = text.trim().split("\n").map(r => r.split(","));

    const table = document.getElementById("table");
    table.innerHTML = ""; // pulisce la tabella ad ogni caricamento

    rows.forEach((row, rowIndex) => {
      const tr = document.createElement("tr");
      
      row.forEach(cell => {
        const td = document.createElement(rowIndex === 0 ? "th" : "td");
        td.textContent = cell.trim();
        tr.appendChild(td);
      });

      table.appendChild(tr);
    });
  };

  reader.readAsText(file);
});
