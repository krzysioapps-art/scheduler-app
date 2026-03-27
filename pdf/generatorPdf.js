export function generatePdf(departments, selectedDeps, selectedEmps, daysInMonth) {
    const root = document.getElementById("print-root");
    root.innerHTML = "";

    selectedDeps.forEach(depId => {
        const dep = departments.find(d => d.id === depId);
        if (!dep) return;

        const section = document.createElement("div");
        section.className = "print-section";

        const title = document.createElement("div");
        title.className = "print-title";
        title.textContent = dep.name;
        section.appendChild(title);

        const table = document.createElement("table");
        table.className = "print-table";

        // HEADER
        const thead = document.createElement("thead");
        const headerRow = document.createElement("tr");

        headerRow.innerHTML =
            `<th>Pracownik</th>` +
            Array.from({ length: daysInMonth }, (_, i) => `<th>${i + 1}</th>`).join("");

        thead.appendChild(headerRow);
        table.appendChild(thead);

        // BODY
        const tbody = document.createElement("tbody");

        dep.employees
            .filter(emp => selectedEmps.includes(emp.id))
            .forEach(emp => {
                const row = document.createElement("tr");

                const daysHtml = emp.days
                    .slice(0, daysInMonth)
                    .map(d => `<td>${formatShift(d)}</td>`)
                    .join("");

                row.innerHTML = `
                    <td>${emp.name}</td>
                    ${daysHtml}
                `;

                tbody.appendChild(row);
            });

        table.appendChild(tbody);
        section.appendChild(table);
        root.appendChild(section);
    });

    root.classList.remove("hidden");

    window.print();

    // po wydruku chowamy
    setTimeout(() => {
        root.classList.add("hidden");
        root.innerHTML = "";
    }, 500);
}

/* skracanie godzin */
function formatShift(shift) {
    if (!shift) return "";

    return shift
        .replace(":00", "")
        .replace("-", "-"); // np 08:00-16:00 -> 8-16
}