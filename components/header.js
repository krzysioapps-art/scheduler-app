async function renderHeader() {
    // pobieramy client w momencie wywołania (nie na starcie modułu)
    const _client = window.client;
    if (!_client) {
        console.error("renderHeader: window.client nie jest dostępny");
        return;
    }

    const container = document.getElementById("header");
    if (!container) return;

    const { data: { user } } = await _client.auth.getUser();

    if (!user) return;

    const { data: emp } = await _client
        .from("employees")
        .select("name, role")
        .eq("auth_user_id", user.id)
        .single();

    container.innerHTML = `
        <div class="app-header">
            <div class="left">
                <strong>Scheduler</strong>
            </div>

            <div class="right">
                <span class="user">
                    👤 ${emp?.name || "User"} (${emp?.role})
                </span>
                <button onclick="logout()">Wyloguj</button>
            </div>
        </div>
    `;
}

async function logout() {
    const _client = window.client;
    if (_client) await _client.auth.signOut();
    window.location.href = "/login/";
}

// eksportuj do window żeby inline scripts mogły wywoływać
window.renderHeader = renderHeader;
window.logout = logout;
