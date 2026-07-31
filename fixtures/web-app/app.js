// App de referencia (fixtures/web-app) — vanilla JS, sin build step, para que el fixture
// sea tan simple de versionar y de abrir (file:// o servido) como sea posible.

const CUSTOMER_ROWS = 20;

function renderCustomerRows() {
  const tbody = document.getElementById("customers-body");
  const rows = [];
  for (let i = 1; i <= CUSTOMER_ROWS; i++) {
    rows.push(
      `<tr><td>Cliente ${i}</td><td><button type="button" class="edit-btn">Editar</button></td></tr>`,
    );
  }
  tbody.innerHTML = rows.join("");
}

function wireLoginForm() {
  const form = document.getElementById("login-form");
  const status = document.getElementById("login-status");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const username = document.getElementById("username").value;
    status.textContent = username ? `Sesión iniciada como ${username}` : "Usuario requerido";
  });
}

function wireLiveToggle() {
  const button = document.getElementById("live-toggle");
  button.addEventListener("click", () => {
    const pressed = button.getAttribute("aria-pressed") === "true";
    button.setAttribute("aria-pressed", String(!pressed));
  });
}

let regenerateCount = 0;

function wireLiveRegenerate() {
  const regenerateButton = document.getElementById("live-regenerate");
  regenerateButton.addEventListener("click", () => {
    regenerateCount += 1;
    const region = document.getElementById("live-region");
    // Reemplaza el subárbol entero por nodos DOM NUEVOS (mismo rol/nombre accesible,
    // pero cero continuidad de identidad DOM) y alterna la clase CSS — así un locator
    // basado en identidad de nodo o en clase CSS se rompe, mientras que testId/role+name
    // sobreviven. Es exactamente el escenario que anticipa la demo de F1.
    region.className = region.className === "theme-a" ? "theme-b" : "theme-a";
    region.innerHTML = `
      <span id="live-counter">${regenerateCount}</span>
      <button id="live-toggle" data-testid="live-toggle" aria-pressed="false">Act/Desact</button>
    `;
    wireLiveToggle();
  });
}

renderCustomerRows();
wireLoginForm();
wireLiveToggle();
wireLiveRegenerate();
