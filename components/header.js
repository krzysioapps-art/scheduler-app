async function renderHeader() {
    const _client = window.client;
    if (!_client) {
        console.error("renderHeader: window.client nie jest dostępny");
        return;
    }

    const container = document.getElementById("header");
    if (!container) return;

    // 👇 1. NAJPIERW loader
    container.innerHTML = `
      <div class="app-header">
        <div class="left">
          <strong>Scheduler</strong>
        </div>
        <div class="right">
          <div class="skeleton" style="width:120px;height:16px;"></div>
        </div>
      </div>
    `;

    try {
        // 👇 2. fetch równolegle gdzie się da
        const { data: { user } } = await _client.auth.getUser();

        if (!user) {
            container.innerHTML = ""; // albo redirect
            return;
        }

        const { data: emp } = await _client
            .from("employees")
            .select("name, role")
            .eq("auth_user_id", user.id)
            .single();

        // 👇 3. final UI
        container.innerHTML = `
            <div class="app-header">
                <div class="left">
                    <strong>Scheduler</strong>
                </div>

                <div class="right">
                    <span class="user">
                        ${emp?.name || "User"}
                    </span>
                    <button class="btn btn-secondary btn-sm" onclick="logout()">Wyloguj</button>
                </div>
            </div>
        `;
    } catch (err) {
        console.error("renderHeader error:", err);

        // 👇 fallback (ważne!)
        container.innerHTML = `
            <div class="app-header">
                <div class="left">
                    <strong>Scheduler</strong>
                </div>
                <div class="right">
                    <span class="user">Błąd</span>
                </div>
            </div>
        `;
    }
}

async function logout() {
    const _client = window.client;
    if (_client) await _client.auth.signOut();
    window.location.href = "/login/";
}

// eksportuj do window żeby inline scripts mogły wywoływać
window.renderHeader = renderHeader;
window.logout = logout;
