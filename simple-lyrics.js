// @ts-check
// NAME: Lyrics Plus
// AUTHOR: Gemini
// DESCRIPTION: Fetches and displays real-time animated lyrics from a dedicated source in a full-screen UI with configurable settings and a performance mode.

(async function lyricsPlus() {
    // Wait for Spicetify APIs to be available before running the script
    while (!Spicetify?.Player || !Spicetify?.Topbar || !Spicetify?.CosmosAsync || !Spicetify?.Platform || !Spicetify.ContextMenu) {
        await new Promise(resolve => setTimeout(resolve, 300));
    }

    const { Player, Topbar, CosmosAsync, Platform, ContextMenu } = Spicetify;

    // --- GOOGLE FONTS INJECTION ---
    const fontLink = document.createElement("link");
    fontLink.rel = "stylesheet";
    fontLink.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;800&family=Lato:wght@400;900&family=Lobster&family=Lora:wght@400;700&family=Merriweather:wght@400;900&family=Montserrat:wght@400;800&family=Pacifico&family=Playfair+Display:wght@400;800&family=Poppins:wght@400;800&family=Roboto:wght@400;900&family=Nunito:wght@400;900&family=EB+Garamond:wght@400;800&family=Caveat:wght@400;700&family=Bebas+Neue&display=swap";
    document.head.appendChild(fontLink);


    // --- CONFIGURATION & SETTINGS ---
    const LYRIC_PROVIDER_URL = "https://lrclib.net/api/get";
    const CONFIG_KEY = "lyrics-plus:config";
    const CACHE_KEY = "lyrics-plus:cache";
    const OFFSETS_KEY = "lyrics-plus:offsets";
    const DEFAULT_CONFIG = {
        autoCache: true,
        performanceMode: false, // 'false' or 'true'
        fontSize: "medium", // 'small', 'medium', 'large'
        lyricsAlign: "center", // 'left', 'center', 'right'
        fontStyle: "sans-serif", // 'sans-serif', 'inter', 'lato', etc.
        fontWeight: "bold", // 'normal', 'bold'
        fontItalic: "normal", // 'normal', 'italic'
        layout: "right", // 'default', 'left', 'right', 'lyrics-only'
        animation: "smooth", // 'smooth', 'fast'
        backgroundAnimation: false, // 'false' or 'true'
        backgroundBlur: "medium", // 'low', 'medium', 'high'
    };
    let currentConfig = { ...DEFAULT_CONFIG };
    let songOffsets = {};
    let currentFetchController = null;

    /**
     * Saves the current configuration to Spicetify's LocalStorage and applies the changes.
     * @param {object} newConfig The new configuration object to save.
     */
    function saveConfig(newConfig) {
        const oldConfig = { ...currentConfig };
        currentConfig = { ...currentConfig, ...newConfig };
        Spicetify.LocalStorage.set(CONFIG_KEY, JSON.stringify(currentConfig));
        applyConfig();

        const performanceModeChanged = newConfig.hasOwnProperty('performanceMode') && oldConfig.performanceMode !== newConfig.performanceMode;
        const layoutChanged = newConfig.hasOwnProperty('layout');

        // If layout or performance mode changes, we need to re-render the shell to apply structural changes
        // and then re-populate it with the current lyrics and progress.
        if (performanceModeChanged || layoutChanged) {
            lyricsStarted = false; 
            renderPageShell(Player.data.item);
            if (currentLyrics) {
                const contentHtml = currentLyrics.map(line => `<p class="lyrics-plus-line" data-time="${line.time}" data-text="${line.text.replace(/"/g, '&quot;')}">${line.text}</p>`).join('');
                renderLyricsContent(contentHtml);
                updateLyricsUI(Player.getProgress());
            }
        }
    }

    /**
     * Loads the configuration from Spicetify's LocalStorage. If no saved config is found, it uses the defaults.
     */
    function loadConfig() {
        try {
            const savedConfig = Spicetify.LocalStorage.get(CONFIG_KEY);
            if (savedConfig) {
                currentConfig = { ...DEFAULT_CONFIG, ...JSON.parse(savedConfig) };
            }
        } catch (e) {
            console.error("[Lyrics+] Error loading config, resetting to defaults.", e);
            Spicetify.showNotification("Lyrics Plus settings corrupted. Resetting to default.", true);
            currentConfig = { ...DEFAULT_CONFIG };
            Spicetify.LocalStorage.remove(CONFIG_KEY);
        }
        applyConfig(); // Apply loaded or default config on startup
    }
    
    /**
     * Loads per-song lyric offsets from LocalStorage.
     */
    function loadOffsets() {
        try {
            const savedOffsets = Spicetify.LocalStorage.get(OFFSETS_KEY);
            if (savedOffsets) {
                songOffsets = JSON.parse(savedOffsets);
            }
        } catch (e) {
            console.error("[Lyrics+] Error loading offsets, resetting.", e);
            Spicetify.showNotification("Lyrics Plus offsets corrupted. Resetting.", true);
            songOffsets = {};
            Spicetify.LocalStorage.remove(OFFSETS_KEY);
        }
    }

    /**
     * Saves the entire song offsets object to LocalStorage.
     */
    function saveOffsets() {
        Spicetify.LocalStorage.set(OFFSETS_KEY, JSON.stringify(songOffsets));
    }

    /**
     * Gets the offset for a specific track URI.
     * @param {string} uri The URI of the track.
     * @returns {number} The offset in milliseconds.
     */
    function getOffsetForTrack(uri) {
        return songOffsets[uri] || 0;
    }

    /**
     * Sets and saves the offset for a specific track URI.
     * @param {string} uri The URI of the track.
     * @param {number} offset The offset in milliseconds.
     */
    function setOffsetForTrack(uri, offset) {
        if (offset === 0) {
            delete songOffsets[uri]; // Keep the storage clean by removing zero offsets
        } else {
            songOffsets[uri] = offset;
        }
        saveOffsets();
        updateLyricsUI(Player.getProgress());
        updateSettingsModalUI(); // Keep settings UI in sync if it's open
    }


    /**
     * Applies the current configuration to the UI by adding/removing CSS classes.
     * This function is the bridge between the settings and the visual appearance.
     */
    function applyConfig() {
        const container = document.getElementById("lyrics-plus-fullscreen-container");
        if (!container) return;
        
        // Apply Performance Mode
        container.classList.toggle("performance-mode", currentConfig.performanceMode);

        // Apply Layout Class
        container.classList.remove("layout-default", "layout-left", "layout-right", "layout-lyrics-only");
        container.classList.add(`layout-${currentConfig.layout}`);

        // Apply Font Size Class
        container.classList.remove("font-size-small", "font-size-medium", "font-size-large");
        container.classList.add(`font-size-${currentConfig.fontSize}`);

        // Apply Lyrics Alignment Class
        container.classList.remove("align-left", "align-center", "align-right");
        container.classList.add(`align-${currentConfig.lyricsAlign}`);

        // Apply Font Style Class
        const fontClasses = ["font-sans-serif", "font-inter", "font-lato", "font-montserrat", "font-poppins", "font-roboto", "font-nunito", "font-serif", "font-playfair-display", "font-merriweather", "font-lora", "font-eb-garamond", "font-lobster", "font-pacifico", "font-caveat", "font-bebas-neue"];
        container.classList.remove(...fontClasses);
        container.classList.add(`font-${currentConfig.fontStyle.replace(/\s+/g, '-').toLowerCase()}`);

        // Apply Font Weight
        container.classList.remove("font-weight-normal", "font-weight-bold");
        container.classList.add(`font-weight-${currentConfig.fontWeight}`);

        // Apply Font Style (Italic)
        container.classList.remove("font-style-normal", "font-style-italic");
        container.classList.add(`font-style-${currentConfig.fontItalic}`);

        // Apply Lyrics Scroll Animation Style Class
        container.classList.remove("animation-smooth", "animation-fast");
        container.classList.add(`animation-${currentConfig.animation}`);
        
        // Apply Background Spinning Animation & Blur
        const background = page.querySelector("#lyrics-plus-background");
        if (background) {
            // Spinning
            background.classList.toggle("spinning", currentConfig.backgroundAnimation && !currentConfig.performanceMode);
            // Blur
            background.classList.remove("blur-low", "blur-medium", "blur-high", "blur-none");
            background.classList.add(currentConfig.performanceMode ? 'blur-none' : `blur-${currentConfig.backgroundBlur}`);
        }
    }


    // --- STATE MANAGEMENT ---
    let currentLyrics = null;
    let availableLyrics = [];
    let isPageVisible = false;
    let currentActiveLineIndex = -1;
    let lyricsStarted = false; // Flag to track if lyrics have started displaying for the current song.
    let isSynced = true; // Flag to track if lyrics are synced with the player
    let scrollTimeout = null;
    let latestFetchUri = null;

    // --- STYLES ---
    const style = document.createElement('style');
    style.innerHTML = `
      #lyrics-plus-fullscreen-container {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background-color: rgba(0,0,0,0.7);
        z-index: 10000;
        display: none;
        justify-content: center;
        align-items: center;
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(4px);
        opacity: 0;
        transition: opacity 0.3s ease-in-out;
        overflow: hidden; /* Hide overflowing spinning background */
      }
      #lyrics-plus-fullscreen-container.visible {
        display: flex;
        opacity: 1;
      }
      #lyrics-plus-background {
        position: absolute;
        top: -62.5%;
        left: -62.5%;
        width: 225vw;
        height: 225vh;
        background-size: cover;
        background-position: center;
        z-index: -1;
        transition: filter 0.3s ease-in-out, background-color 0.5s ease, background-image 0.5s ease;
        transform-origin: center center;
        will-change: transform;
      }
      .lyrics-plus-content-wrapper {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
        position: relative;
        padding: 20px;
        box-sizing: border-box;
      }
      .layout-default .lyrics-plus-content-wrapper {
        flex-direction: column;
      }
      .layout-left .lyrics-plus-content-wrapper {
        flex-direction: row-reverse;
      }
      .layout-right .lyrics-plus-content-wrapper {
        flex-direction: row;
      }

      .lyrics-plus-player-info {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        background: rgba(0, 0, 0, 0.2);
        padding: 20px;
        border-radius: 20px;
      }
      .layout-left .lyrics-plus-player-info, .layout-right .lyrics-plus-player-info {
        width: 30%;
        max-width: 330px;
        padding: 0 20px;
      }
      .layout-lyrics-only .lyrics-plus-player-info {
        display: none;
      }

      .lyrics-plus-top-left-controls button {
        position: absolute;
        top: 74px;
        z-index: 10;
        background: none;
        border: none;
        color: white;
        cursor: pointer;
        opacity: 0.7;
        transition: all 0.2s;
      }
      .lyrics-plus-top-left-controls button:hover {
          opacity: 1;
          transform: scale(1.1);
      }
      #lyrics-plus-close-btn {
        left: 20px;
      }
      #lyrics-plus-settings-btn {
        left: 60px;
      }
      .lyrics-plus-album-title {
        font-size: 0.9rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 1px;
        opacity: 0.7;
        margin-bottom: 12px;
      }
      #lyrics-plus-cover-art {
        width: 242px;
        height: 242px;
        border-radius: 16px;
        background-size: cover;
        box-shadow: 0 10px 30px rgba(0,0,0,0.5);
        flex-shrink: 0;
        margin-bottom: 20px;
      }
      .lyrics-plus-song-title {
        font-size: 1.5rem;
        font-weight: 900;
        margin-top: 20px;
        color: white;
      }
      .lyrics-plus-artist-names {
        font-size: 1rem;
        font-weight: 500;
        opacity: 0.8;
        margin-bottom: 10px;
      }
      .lyrics-plus-viewport {
        width: 100%;
        max-width: 800px;
        height: 40vh;
        -webkit-mask-image: linear-gradient(transparent 0%, black 20%, black 80%, transparent 100%);
        mask-image: linear-gradient(transparent 0%, black 20%, black 80%, transparent 100%);
        position: relative;
        overflow: hidden;
      }
      .lyrics-plus-viewport.lyrics-hidden .lyrics-plus-content {
        opacity: 0;
      }
      
      .layout-left .lyrics-plus-viewport, .layout-right .lyrics-plus-viewport {
        width: 70%;
        height: 80vh;
      }
      .layout-lyrics-only .lyrics-plus-viewport {
        height: 80vh;
      }

      .lyrics-plus-content {
        width: 100%;
        height: 100%;
        padding: 50% 24px;
        transition: transform 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 0.5s ease-in-out;
        position: relative;
      }
      .lyrics-plus-line {
        line-height: 1.5;
        color: rgba(255,255,255,0.4);
        transition: color 0.5s ease-in-out, opacity 0.5s ease-in-out, filter 0.5s ease;
        padding: 10px 0;
        position: relative;
        cursor: pointer;
      }
      .lyrics-plus-line:hover {
        color: rgba(255,255,255,0.7);
      }
      .lyrics-plus-line.past {
        opacity: 0.2;
        filter: blur(1px);
      }
      .lyrics-plus-line.active {
        color: white;
        opacity: 1;
      }
      .lyrics-plus-message {
        color: white;
        font-size: 1.5rem;
        font-style: italic;
      }
      #lyrics-plus-resync-btn {
        position: absolute;
        bottom: 40px;
        left: 50%;
        transform: translateX(-50%);
        background-color: rgba(0,0,0,0.7);
        color: white;
        border: 1px solid rgba(255,255,255,0.3);
        border-radius: 24px;
        padding: 10px 20px;
        font-size: 1rem;
        cursor: pointer;
        opacity: 0;
        visibility: hidden;
        transition: opacity 0.3s, visibility 0.3s;
        z-index: 20;
      }
      #lyrics-plus-resync-btn.visible {
        opacity: 1;
        visibility: visible;
      }


      /* Player Controls */
      .lyrics-plus-controls {
        width: 100%;
        max-width: 242px; /* Increased by 10% */
        margin-top: 10px;
        color: white;
      }
      .lyrics-plus-progress-time {
        display: flex;
        justify-content: space-between;
        font-size: 0.8rem;
        opacity: 0.7;
      }
      .lyrics-plus-progress-bar-container {
        width: 100%;
        height: 4px;
        background-color: rgba(255,255,255,0.2);
        border-radius: 2px;
        margin: 8px 0;
        cursor: pointer;
      }
      #lyrics-plus-progress-bar {
        height: 100%;
        width: 0%;
        background-color: white;
        border-radius: 2px;
        transition: background-color 0.5s ease;
      }
      .lyrics-plus-buttons {
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 20px;
        margin-top: 8px;
      }
      .lyrics-plus-buttons button {
        background: none;
        border: none;
        color: white;
        cursor: pointer;
        opacity: 0.8;
        transition: all 0.2s;
      }
      .lyrics-plus-buttons button:hover {
        opacity: 1;
        transform: scale(1.1);
      }
      #lyrics-plus-play-pause-btn {
        width: 40px;
        height: 40px;
        background-color: white;
        color: black;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background-color 0.5s ease, color 0.5s ease;
      }
      .lyrics-plus-buttons svg {
        pointer-events: none;
      }

      /* Settings & Chooser Modal Styles */
      #lyrics-plus-settings-modal, #lyrics-plus-choose-modal {
          position: fixed;
          top: 0; left: 0;
          width: 100%; height: 100%;
          background: rgba(0, 0, 0, 0.7);
          z-index: 10001;
          display: none;
          justify-content: center;
          align-items: center;
      }
      #lyrics-plus-settings-modal.visible, #lyrics-plus-choose-modal.visible {
          display: flex;
      }
      .lyrics-plus-settings-content, .lyrics-plus-choose-content {
          background-color: rgba(40, 40, 40, 0.4);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          color: white;
          padding: 24px;
          border-radius: 12px;
          width: 90%;
          max-width: 450px;
          max-height: 90vh;
          overflow-y: auto;
          box-shadow: 0 5px 20px rgba(0,0,0,0.5);
      }
      .lyrics-plus-settings-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
      }
      .lyrics-plus-settings-header h2 {
          font-size: 1.2rem; margin: 0;
      }
      #lyrics-plus-settings-close-btn {
          background: none; border: none; color: white; opacity: 0.7; cursor: pointer;
      }
      .lyrics-plus-settings-section {
          margin-bottom: 20px;
      }
      .lyrics-plus-settings-section:last-child {
          margin-bottom: 0;
      }
      .lyrics-plus-settings-section h3 {
          font-size: 0.9rem;
          text-transform: uppercase;
          letter-spacing: 1px;
          opacity: 0.7;
          margin-bottom: 10px;
      }
      .lyrics-plus-settings-options {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
      }
      .lyrics-plus-settings-options button {
          background-color: rgba(255, 255, 255, 0.1);
          border: 1px solid transparent;
          color: white;
          padding: 8px 16px;
          border-radius: 20px;
          cursor: pointer;
          transition: background-color 0.2s, border-color 0.2s;
      }
      .lyrics-plus-settings-options button:hover {
          background-color: rgba(255, 255, 255, 0.2);
      }
      .lyrics-plus-settings-options button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .lyrics-plus-settings-options button.active {
          background-color: rgba(255, 255, 255, 0.3);
          color: white;
          border-color: transparent;
      }
      #lyrics-plus-offset-value {
        padding: 8px 16px;
        background-color: rgba(255, 255, 255, 0.1);
        border-radius: 20px;
        min-width: 80px;
        text-align: center;
      }
      #lyrics-plus-font-select {
        width: 100%;
        padding: 8px;
        border-radius: 4px;
        background-color: rgba(255, 255, 255, 0.1);
        color: white;
        border: 1px solid rgba(255, 255, 255, 0.2);
      }
      #lyrics-plus-status-section {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        background-color: rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        margin-bottom: 20px;
      }
      #lyrics-plus-provider-status-indicator {
        font-size: 1.5rem;
        line-height: 1;
        transition: color 0.3s;
      }
      #lyrics-plus-provider-status-indicator.online {
        color: #1DB954; /* Spotify green */
      }
      #lyrics-plus-provider-status-indicator.offline {
        color: #E22134; /* Red for offline */
      }
      #lyrics-plus-provider-status-indicator.not-found {
        color: #3B82F6; /* Blue for not found */
      }
      #lyrics-plus-settings-indicator {
        transition: fill 0.3s;
      }
      #lyrics-plus-settings-indicator.online {
        fill: #1DB954;
      }
      #lyrics-plus-settings-indicator.offline {
        fill: #E22134;
      }
      #lyrics-plus-settings-indicator.not-found {
        fill: #3B82F6;
      }
      .lyrics-plus-choose-list {
        list-style: none;
        padding: 0;
        margin: 0;
      }
      .lyrics-plus-choose-list li {
        padding: 12px;
        border-radius: 8px;
        background-color: rgba(255, 255, 255, 0.1);
        margin-bottom: 8px;
        cursor: pointer;
        transition: background-color 0.2s;
        text-align: left;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .lyrics-plus-choose-list li:hover {
        background-color: rgba(255, 255, 255, 0.2);
      }

      /* --- DYNAMIC & PERFORMANCE STYLES --- */
      /* Background Blur Levels */
      #lyrics-plus-background.blur-none { filter: blur(0px) brightness(0.6); }
      #lyrics-plus-background.blur-low { filter: blur(10px) brightness(0.5); }
      #lyrics-plus-background.blur-medium { filter: blur(20px) brightness(0.5); }
      #lyrics-plus-background.blur-high { filter: blur(40px) brightness(0.5); }

      /* Background Spinning Animation */
      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      #lyrics-plus-background.spinning {
        animation: spin 60s linear infinite;
      }

      /* Font Size */
      #lyrics-plus-fullscreen-container.font-size-small .lyrics-plus-line { font-size: 1.8rem; }
      #lyrics-plus-fullscreen-container.font-size-medium .lyrics-plus-line { font-size: 2.2rem; }
      #lyrics-plus-fullscreen-container.font-size-large .lyrics-plus-line { font-size: 2.8rem; }
      
      /* Font Weight */
      #lyrics-plus-fullscreen-container.font-weight-normal .lyrics-plus-line { font-weight: 400; }
      #lyrics-plus-fullscreen-container.font-weight-bold .lyrics-plus-line { font-weight: 800; }

      /* Font Style */
      #lyrics-plus-fullscreen-container.font-style-normal .lyrics-plus-line { font-style: normal; }
      #lyrics-plus-fullscreen-container.font-style-italic .lyrics-plus-line { font-style: italic; }

      /* Lyrics Alignment */
      #lyrics-plus-fullscreen-container.align-left .lyrics-plus-viewport { text-align: left; }
      #lyrics-plus-fullscreen-container.align-center .lyrics-plus-viewport { text-align: center; }
      #lyrics-plus-fullscreen-container.align-right .lyrics-plus-viewport { text-align: right; }

      /* Font Style */
      #lyrics-plus-fullscreen-container.font-sans-serif .lyrics-plus-line { font-family: 'CircularSp', sans-serif; }
      #lyrics-plus-fullscreen-container.font-inter .lyrics-plus-line { font-family: 'Inter', sans-serif; }
      #lyrics-plus-fullscreen-container.font-lato .lyrics-plus-line { font-family: 'Lato', sans-serif; }
      #lyrics-plus-fullscreen-container.font-montserrat .lyrics-plus-line { font-family: 'Montserrat', sans-serif; }
      #lyrics-plus-fullscreen-container.font-poppins .lyrics-plus-line { font-family: 'Poppins', sans-serif; }
      #lyrics-plus-fullscreen-container.font-roboto .lyrics-plus-line { font-family: 'Roboto', sans-serif; }
      #lyrics-plus-fullscreen-container.font-nunito .lyrics-plus-line { font-family: 'Nunito', sans-serif; }
      #lyrics-plus-fullscreen-container.font-serif .lyrics-plus-line { font-family: 'Georgia', serif; }
      #lyrics-plus-fullscreen-container.font-playfair-display .lyrics-plus-line { font-family: 'Playfair Display', serif; }
      #lyrics-plus-fullscreen-container.font-merriweather .lyrics-plus-line { font-family: 'Merriweather', serif; }
      #lyrics-plus-fullscreen-container.font-lora .lyrics-plus-line { font-family: 'Lora', serif; }
      #lyrics-plus-fullscreen-container.font-eb-garamond .lyrics-plus-line { font-family: 'EB Garamond', serif; }
      #lyrics-plus-fullscreen-container.font-lobster .lyrics-plus-line { font-family: 'Lobster', cursive; }
      #lyrics-plus-fullscreen-container.font-pacifico .lyrics-plus-line { font-family: 'Pacifico', cursive; }
      #lyrics-plus-fullscreen-container.font-caveat .lyrics-plus-line { font-family: 'Caveat', cursive; }
      #lyrics-plus-fullscreen-container.font-bebas-neue .lyrics-plus-line { font-family: 'Bebas Neue', sans-serif; }

      /* Lyrics Scroll Speed */
      #lyrics-plus-fullscreen-container.animation-smooth .lyrics-plus-content { transition-duration: 0.8s; }
      #lyrics-plus-fullscreen-container.animation-fast .lyrics-plus-content { transition-duration: 0.3s; }

      /* Performance Mode Overrides */
      #lyrics-plus-fullscreen-container.performance-mode {
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
        background-color: #000;
      }
      #lyrics-plus-fullscreen-container.performance-mode .lyrics-plus-content {
        transition: none !important;
      }
      #lyrics-plus-fullscreen-container.performance-mode .lyrics-plus-line {
        transition: none !important;
      }
      #lyrics-plus-fullscreen-container.performance-mode .lyrics-plus-line.past {
        filter: none !important;
        opacity: 0.25;
      }
    `;
    document.head.appendChild(style);

    // --- UI ELEMENTS ---
    const page = document.createElement("div");
    page.id = "lyrics-plus-fullscreen-container";
    document.body.appendChild(page);

    const settingsModal = document.createElement("div");
    settingsModal.id = "lyrics-plus-settings-modal";
    document.body.appendChild(settingsModal);

    /**
     * Creates the HTML structure for the settings modal.
     */
    function createSettingsModal() {
        settingsModal.innerHTML = `
            <div class="lyrics-plus-settings-content">
                <div class="lyrics-plus-settings-header">
                    <h2>Settings</h2>
                    <button id="lyrics-plus-settings-close-btn" title="Close">
                        <svg height="16" width="16" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M1.47 1.47a.75.75 0 011.06 0L8 6.94l5.47-5.47a.75.75 0 111.06 1.06L9.06 8l5.47 5.47a.75.75 0 11-1.06 1.06L8 9.06l-5.47 5.47a.75.75 0 01-1.06-1.06L6.94 8 1.47 2.53a.75.75 0 010-1.06z"></path>
                        </svg>
                    </button>
                </div>

                <div class="lyrics-plus-settings-section" id="lyrics-plus-status-section">
                    <span>Provider Status (Lrclib):</span> 
                    <span id="lyrics-plus-provider-status-indicator">●</span> 
                    <span id="lyrics-plus-provider-status-text">Checking...</span>
                </div>

                <div class="lyrics-plus-settings-section">
                    <h3>Performance Mode</h3>
                    <div class="lyrics-plus-settings-options" data-setting="performanceMode">
                        <button data-value="true">On</button>
                        <button data-value="false">Off</button>
                    </div>
                </div>
                
                <div class="lyrics-plus-settings-section">
                    <h3>Caching & Export</h3>
                    <div class="lyrics-plus-settings-options" data-setting="autoCache">
                        <label>Auto Cache:</label>
                        <button data-value="true">On</button>
                        <button data-value="false">Off</button>
                    </div>
                    <div class="lyrics-plus-settings-options" style="margin-top: 10px;">
                         <button id="lyrics-plus-cache-now-btn">Cache Current Song</button>
                         <button id="lyrics-plus-clear-current-cache-btn">Clear Current Cache</button>
                         <button id="lyrics-plus-clear-cache-btn">Clear All Cache</button>
                         <button id="lyrics-plus-export-lrc-btn">Export .lrc</button>
                    </div>
                </div>

                <div class="lyrics-plus-settings-section">
                    <h3>Lyrics Offset</h3>
                    <div class="lyrics-plus-settings-options" data-setting="lyricsOffset">
                        <button id="lyrics-plus-offset-decrease" title="Decrease offset by 100ms">-100ms</button>
                        <span id="lyrics-plus-offset-value">0 ms</span>
                        <button id="lyrics-plus-offset-increase" title="Increase offset by 100ms">+100ms</button>
                        <button id="lyrics-plus-offset-reset" title="Reset offset for this song">Reset</button>
                    </div>
                </div>

                <div class="lyrics-plus-settings-section">
                    <h3>Layout</h3>
                    <div class="lyrics-plus-settings-options" data-setting="layout">
                        <button data-value="left">Left</button>
                        <button data-value="right">Right</button>
                        <button data-value="lyrics-only">Lyrics Only</button>
                    </div>
                </div>
                <div class="lyrics-plus-settings-section">
                    <h3>Font Size</h3>
                    <div class="lyrics-plus-settings-options" data-setting="fontSize">
                        <button data-value="small">Small</button>
                        <button data-value="medium">Medium</button>
                        <button data-value="large">Large</button>
                    </div>
                </div>
                <div class="lyrics-plus-settings-section">
                    <h3>Font Weight</h3>
                    <div class="lyrics-plus-settings-options" data-setting="fontWeight">
                        <button data-value="normal">Normal</button>
                        <button data-value="bold">Bold</button>
                    </div>
                </div>
                <div class="lyrics-plus-settings-section">
                    <h3>Font Style</h3>
                    <div class="lyrics-plus-settings-options" data-setting="fontItalic">
                        <button data-value="normal">Normal</button>
                        <button data-value="italic">Italic</button>
                    </div>
                </div>
                <div class="lyrics-plus-settings-section">
                    <h3>Lyrics Alignment</h3>
                    <div class="lyrics-plus-settings-options" data-setting="lyricsAlign">
                        <button data-value="left">Left</button>
                        <button data-value="center">Center</button>
                        <button data-value="right">Right</button>
                    </div>
                </div>
                <div class="lyrics-plus-settings-section">
                    <h3>Font Style</h3>
                    <select id="lyrics-plus-font-select" data-setting="fontStyle">
                        <optgroup label="Sans-serif">
                            <option value="inter">Inter</option>
                            <option value="lato">Lato</option>
                            <option value="montserrat">Montserrat</option>
                            <option value="poppins">Poppins</option>
                            <option value="roboto">Roboto</option>
                            <option value="nunito">Nunito</option>
                        </optgroup>
                        <optgroup label="Serif">
                            <option value="playfair-display">Playfair Display</option>
                            <option value="merriweather">Merriweather</option>
                            <option value="lora">Lora</option>
                            <option value="eb-garamond">EB Garamond</option>
                        </optgroup>
                        <optgroup label="Display">
                            <option value="lobster">Lobster</option>
                            <option value="pacifico">Pacifico</option>
                            <option value="caveat">Caveat</option>
                            <option value="bebas-neue">Bebas Neue</option>
                        </optgroup>
                    </select>
                </div>
                <div class="lyrics-plus-settings-section">
                    <h3>Lyrics Scroll</h3>
                    <div class="lyrics-plus-settings-options" data-setting="animation">
                        <button data-value="smooth">Smooth</button>
                        <button data-value="fast">Fast</button>
                    </div>
                </div>
                <div class="lyrics-plus-settings-section">
                    <h3>Background Blur</h3>
                    <div class="lyrics-plus-settings-options" data-setting="backgroundBlur">
                        <button data-value="low">Low</button>
                        <button data-value="medium">Medium</button>
                        <button data-value="high">High</button>
                    </div>
                </div>
                <div class="lyrics-plus-settings-section">
                    <h3>Animated Background</h3>
                    <div class="lyrics-plus-settings-options" data-setting="backgroundAnimation">
                        <button data-value="true">On</button>
                        <button data-value="false">Off</button>
                    </div>
                </div>
            </div>
        `;

        settingsModal.addEventListener('click', (e) => {
            const target = e.target;

            // Handle modal close
            if (target.closest("#lyrics-plus-settings-close-btn") || e.target === settingsModal) {
                toggleSettingsModal(false);
            }

            // Handle offset controls
            const currentTrackUri = Player.data?.item?.uri;
            if (currentTrackUri) {
                if (target.closest('#lyrics-plus-offset-decrease')) {
                    const currentOffset = getOffsetForTrack(currentTrackUri);
                    setOffsetForTrack(currentTrackUri, currentOffset - 100);
                } else if (target.closest('#lyrics-plus-offset-increase')) {
                    const currentOffset = getOffsetForTrack(currentTrackUri);
                    setOffsetForTrack(currentTrackUri, currentOffset + 100);
                } else if (target.closest('#lyrics-plus-offset-reset')) {
                    setOffsetForTrack(currentTrackUri, 0);
                }
            }

            // Handle other settings buttons
            const button = target.closest('.lyrics-plus-settings-options button');
            if (button) {
                if (button.id === 'lyrics-plus-cache-now-btn') {
                    cacheCurrentSongLyrics();
                    button.textContent = 'Cached!';
                    setTimeout(() => { button.textContent = 'Cache Current Song'; }, 1500);
                    return;
                }
                if (button.id === 'lyrics-plus-clear-current-cache-btn') {
                    clearCurrentSongCache();
                    button.textContent = 'Cleared!';
                    setTimeout(() => { button.textContent = 'Clear Current Cache'; }, 1500);
                    return;
                }
                if (button.id === 'lyrics-plus-clear-cache-btn') {
                    clearCache();
                    button.textContent = 'All Cache Cleared!';
                    setTimeout(() => { button.textContent = 'Clear All Cache'; }, 1500);
                    return;
                }
                if (button.id === 'lyrics-plus-export-lrc-btn') {
                    exportLRC();
                    return;
                }
                const setting = button.parentElement.dataset.setting;
                if (setting && setting !== 'lyricsOffset') { // Make sure not to conflict with offset buttons
                    let value = button.dataset.value;
                    if (setting === 'backgroundAnimation' || setting === 'performanceMode' || setting === 'autoCache') {
                        value = (value === 'true');
                    }
                    saveConfig({ [setting]: value });
                    updateSettingsModalUI();
                }
            }
        });

        const fontSelect = settingsModal.querySelector("#lyrics-plus-font-select");
        fontSelect.addEventListener('change', (e) => {
            saveConfig({ fontStyle: e.target.value });
            updateSettingsModalUI();
        });
    }

    /**
     * Updates the settings modal UI to reflect the current configuration.
     */
    function updateSettingsModalUI() {
        // Update general settings buttons
        settingsModal.querySelectorAll('.lyrics-plus-settings-options button').forEach(btn => {
            const setting = btn.parentElement.dataset.setting;
            if (setting && currentConfig.hasOwnProperty(setting)) {
                const value = btn.dataset.value;
                btn.classList.toggle('active', String(currentConfig[setting]) === value);
            }
        });

        // Update font select
        const fontSelect = settingsModal.querySelector("#lyrics-plus-font-select");
        if (fontSelect) fontSelect.value = currentConfig.fontStyle;

        // Update offset display
        const offsetValueEl = settingsModal.querySelector("#lyrics-plus-offset-value");
        if (offsetValueEl) {
            const currentTrackUri = Player.data?.item?.uri;
            if (currentTrackUri) {
                const offset = getOffsetForTrack(currentTrackUri);
                offsetValueEl.textContent = `${offset} ms`;
            } else {
                offsetValueEl.textContent = 'N/A';
            }
        }
    }

    /**
     * Updates the status indicator in the settings modal.
     * @param {'online' | 'offline' | 'not-found' | 'checking'} status The current status.
     * @param {string} message The message to display.
     */
    function updateStatusIndicator(status, message) {
        const indicatorEl = settingsModal.querySelector("#lyrics-plus-provider-status-indicator");
        const textEl = settingsModal.querySelector("#lyrics-plus-provider-status-text");
        const globalIndicatorEl = document.querySelector("#lyrics-plus-settings-indicator");

        if (indicatorEl && textEl) {
            indicatorEl.className = 'lyrics-plus-provider-status-indicator'; // Reset classes
            if (status) {
                indicatorEl.classList.add(status);
            }
            textEl.textContent = message;
        }
        if(globalIndicatorEl) {
            globalIndicatorEl.className = 'lyrics-plus-settings-indicator'; // Reset classes
            if (status) {
                globalIndicatorEl.classList.add(status);
            }
        }
    }

    /**
     * Toggles the visibility of the settings modal.
     * @param {boolean} visible Whether the modal should be visible.
     */
    function toggleSettingsModal(visible) {
        settingsModal.classList.toggle("visible", visible);
        if (visible) {
            updateSettingsModalUI();
        }
    }

    // Add a global keydown listener for the Escape key
    window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            if (settingsModal.classList.contains('visible')) {
                toggleSettingsModal(false);
            } else if (isPageVisible) {
                togglePage(false);
            }
        }
    });

    // Use event delegation on the main page for all controls
    page.addEventListener('click', (event) => {
        const target = event.target;
        if (target.closest('#lyrics-plus-play-pause-btn')) Player.togglePlay();
        else if (target.closest('#lyrics-plus-forward-btn')) Player.next();
        else if (target.closest('#lyrics-plus-backward-btn')) Player.back();
        else if (target.closest('#lyrics-plus-settings-btn')) toggleSettingsModal(true);
        else if (target.closest('#lyrics-plus-close-btn')) togglePage(false);
        else if (target.closest('#lyrics-plus-resync-btn')) {
            isSynced = true;
            target.closest('#lyrics-plus-resync-btn').classList.remove('visible');
            updateLyricsUI(Player.getProgress());
        }
        else if (target.closest('.lyrics-plus-progress-bar-container')) {
            const progressBar = target.closest('.lyrics-plus-progress-bar-container');
            const rect = progressBar.getBoundingClientRect();
            const clickPosition = event.clientX - rect.left;
            const barWidth = progressBar.clientWidth;
            const seekPercentage = clickPosition / barWidth;
            const seekTime = Player.data.duration * seekPercentage;
            Player.seek(seekTime);
        } else {
            const line = event.target.closest('.lyrics-plus-line');
            if (line && currentLyrics) {
                const time = parseInt(line.dataset.time, 10);
                if (!isNaN(time)) {
                    Player.seek(time);
                }
            }
        }
    });

    /**
     * Toggles the visibility of the main lyrics page.
     * @param {boolean} visible Whether the page should be visible.
     */
    function togglePage(visible) {
        isPageVisible = visible;
        page.classList.toggle("visible", isPageVisible);
        toggleButton.element.classList.toggle("active", isPageVisible);
        if (isPageVisible) {
        const currentTrack = Player.data?.item;
        if (currentTrack) {
            fetchLyrics(currentTrack); // Ensure lyrics are fetched on open
        }
        updatePlayerControlsUI(Player.data);
        updateLyricsUI(Player.getProgress());
    }
    }

    // Create the top bar button to toggle the lyrics page
    const toggleButton = new Topbar.Button("Lyrics", `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" height="16" width="16"><path d="M12.5 8.89001V18.5M12.5 8.89001V5.57656C12.5 5.36922 12.5 5.26554 12.5347 5.17733C12.5653 5.09943 12.615 5.03047 12.6792 4.97678C12.752 4.91597 12.8503 4.88318 13.047 4.81761L17.447 3.35095C17.8025 3.23245 17.9803 3.17319 18.1218 3.20872C18.2456 3.23982 18.3529 3.31713 18.4216 3.42479C18.5 3.54779 18.5 3.73516 18.5 4.10989V7.42335C18.5 7.63069 18.5 7.73436 18.4653 7.82258C18.4347 7.90048 18.385 7.96943 18.3208 8.02313C18.248 8.08394 18.1497 8.11672 17.953 8.18229L13.553 9.64896C13.1975 9.76746 13.0197 9.82671 12.8782 9.79119C12.7544 9.76009 12.6471 9.68278 12.5784 9.57512C12.5 9.45212 12.5 9.26475 12.5 8.89001ZM12.5 18.5C12.5 19.8807 10.933 21 9 21C7.067 21 5.5 19.8807 5.5 18.5C5.5 17.1192 7.067 16 9 16C10.933 16 12.5 17.1192 12.5 18.5Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`, false);
    toggleButton.element.onclick = () => togglePage(!isPageVisible);

    /**
     * Renders the main shell of the lyrics page (background, track info, controls).
     * @param {object} track The current track object from Spicetify.
     */
    function renderPageShell(track) {
        const image_url = track?.metadata?.image_xlarge_url || track?.metadata?.image_url || '';
        const album_title = track?.context?.metadata?.name || track?.metadata?.album_title || '';
        const song_title = track?.metadata?.title || '';
        const artist_names = track?.metadata?.artist_name || '';

        page.innerHTML = `
          <div id="lyrics-plus-background"></div>
          <div class="lyrics-plus-content-wrapper">
             <div class="lyrics-plus-top-left-controls">
                <button id="lyrics-plus-close-btn" title="Close">
                    <svg height="24" width="24" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M1.47 1.47a.75.75 0 011.06 0L8 6.94l5.47-5.47a.75.75 0 111.06 1.06L9.06 8l5.47 5.47a.75.75 0 11-1.06 1.06L8 9.06l-5.47 5.47a.75.75 0 01-1.06-1.06L6.94 8 1.47 2.53a.75.75 0 010-1.06z"></path>
                    </svg>
                </button>
                <button id="lyrics-plus-settings-btn" title="Settings">
                    <svg width="24" height="24" viewBox="0 0 24 24" version="1.1" xmlns="http://www.w3.org/2000/svg">
                        <path d="M10.069,3.36281 C10.7151,1.54573 13.2849,1.54573 13.931,3.3628 C14.338,4.5071 15.6451,5.04852 16.742,4.52713 C18.4837,3.69918 20.3008,5.51625 19.4729,7.25803 C18.9515,8.35491 19.4929,9.66203 20.6372,10.069 C22.4543,10.7151 22.4543,13.2849 20.6372,13.931 C19.4929,14.338 18.9515,15.6451 19.4729,16.742 C20.3008,18.4837 18.4837,20.3008 16.742,19.4729 C15.6451,18.9515 14.338,19.4929 13.931,20.6372 C13.2849,22.4543 10.7151,22.4543 10.069,20.6372 C9.66203,19.4929 8.35491,18.9515 7.25803,19.4729 C5.51625,20.3008 3.69918,18.4837 4.52713,16.742 C5.04852,15.6451 4.5071,14.338 3.3628,13.931 C1.54573,13.2849 1.54573,10.7151 3.36281,10.069 C4.5071,9.66203 5.04852,8.35491 4.52713,7.25803 C3.69918,5.51625 5.51625,3.69918 7.25803,4.52713 C8.35491,5.04852 9.66203,4.5071 10.069,3.36281 Z" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
                        <circle id="lyrics-plus-settings-indicator" cx="12" cy="12" r="3" fill="#888" stroke="none"></circle>
                    </svg>
                </button>
            </div>
            <div class="lyrics-plus-player-info">
                <div class="lyrics-plus-album-title">${album_title}</div>
                <div id="lyrics-plus-cover-art" style="background-image: url(${image_url})"></div>
                <div class="lyrics-plus-song-title">${song_title}</div>
                <div class="lyrics-plus-artist-names">${artist_names}</div>
                <div class="lyrics-plus-controls">
                    <div class="lyrics-plus-progress-time">
                        <span id="lyrics-plus-time-current">0:00</span>
                        <span id="lyrics-plus-time-total">0:00</span>
                    </div>
                    <div class="lyrics-plus-progress-bar-container">
                        <div id="lyrics-plus-progress-bar"></div>
                    </div>
                    <div class="lyrics-plus-buttons">
                        <button id="lyrics-plus-backward-btn" title="Previous">
                            <svg height="20" width="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 5V19M17 7.329V16.671C17 17.7367 17 18.2695 16.7815 18.5432C16.5916 18.7812 16.3035 18.9197 15.9989 18.9194C15.6487 18.919 15.2327 18.5861 14.4005 17.9204L10.1235 14.4988C9.05578 13.6446 8.52194 13.2176 8.32866 12.7016C8.1592 12.2492 8.1592 11.7508 8.32866 11.2984C8.52194 10.7824 9.05578 10.3554 10.1235 9.50122L14.4005 6.07961C15.2327 5.41387 15.6487 5.081 15.9989 5.08063C16.3035 5.0803 16.5916 5.21876 16.7815 5.45677C17 5.73045 17 6.2633 17 7.329Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                        </button>
                        <button id="lyrics-plus-play-pause-btn" title="Play/Pause"></button>
                        <button id="lyrics-plus-forward-btn" title="Next">
                            <svg height="20" width="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M17 5V19M7 7.329V16.671C7 17.7367 7 18.2695 7.21846 18.5432C7.40845 18.7812 7.69654 18.9197 8.00108 18.9194C8.35125 18.919 8.76734 18.5861 9.59951 17.9204L13.8765 14.4988C14.9442 13.6446 15.4781 13.2176 15.6713 12.7016C15.8408 12.2492 15.8408 11.7508 15.6713 11.2984C15.4781 10.7824 14.9442 10.3554 13.8765 9.50122L9.59951 6.07961C8.76734 5.41387 8.35125 5.081 8.00108 5.08063C7.69654 5.0803 7.40845 5.21876 7.21846 5.45677C7 5.73045 7 6.2633 7 7.329Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                        </button>
                    </div>
                </div>
            </div>
            <div class="lyrics-plus-viewport lyrics-hidden">
              <div class="lyrics-plus-content"></div>
              <button id="lyrics-plus-resync-btn">Re-sync</button>
            </div>
          </div>
        `;
        // Handle background and color logic
        const background = page.querySelector("#lyrics-plus-background");
        const playPauseBtn = page.querySelector("#lyrics-plus-play-pause-btn");

        if (currentConfig.performanceMode) {
            background.style.backgroundImage = 'none';
            getDominantColors(image_url, (colors) => {
                const primaryColor = colors[0] || 'rgb(80,80,80)';
                const gradient = `linear-gradient(135deg, ${colors.join(', ')})`;
                background.style.backgroundImage = gradient;
                updateControlColors(playPauseBtn, primaryColor);
            });
        } else {
            background.style.backgroundImage = `url(${image_url})`;
            background.style.backgroundColor = 'transparent';
             getDominantColors(image_url, (colors) => {
                const primaryColor = colors[0] || 'rgb(80,80,80)';
                updateControlColors(playPauseBtn, primaryColor);
            });
        }
        
        const viewport = page.querySelector('.lyrics-plus-viewport');
        viewport.addEventListener('wheel', (e) => {
            if (!currentLyrics) return;
            
            clearTimeout(scrollTimeout);
            isSynced = false;
            document.getElementById('lyrics-plus-resync-btn').classList.add('visible');

            const content = page.querySelector('.lyrics-plus-content');
            const currentTransform = new DOMMatrix(getComputedStyle(content).transform);
            let currentY = currentTransform.m42;
            let newY = currentY - e.deltaY;

            // Clamp the scroll
            const maxScroll = 0;
            const minScroll = -(content.scrollHeight - viewport.clientHeight);
            newY = Math.max(minScroll, Math.min(maxScroll, newY));

            content.style.transition = 'none'; // Disable smooth transition for manual scroll
            content.style.transform = `translateY(${newY}px)`;

            scrollTimeout = setTimeout(() => {
                isSynced = true;
                document.getElementById('lyrics-plus-resync-btn').classList.remove('visible');
                updateLyricsUI(Player.getProgress());
            }, 3000);
        });

        applyConfig(); // Re-apply config to the newly rendered page
    }

    /**
     * Renders the actual lyrics lines or a message into the content area.
     * @param {string} html The HTML string to render.
     */
    function renderLyricsContent(html) {
        const contentContainer = page.querySelector('.lyrics-plus-content');
        if (contentContainer) {
            if (html.startsWith('<p')) { // It's lyrics
                contentContainer.innerHTML = html;
            } else { // It's a message
                contentContainer.innerHTML = `<p class="lyrics-plus-message">${html}</p>`;
            }
        }
    }

    /**
     * Determines if a color is light or dark.
     * @param {string} color The RGB color string (e.g., "rgb(255, 100, 0)").
     * @returns {boolean} True if the color is light, false otherwise.
     */
    function isColorLight(color) {
        const [r, g, b] = color.match(/\d+/g).map(Number);
        // Using the HSP (Highly Sensitive Poo) equation to determine brightness
        const hsp = Math.sqrt(0.299 * (r * r) + 0.587 * (g * g) + 0.114 * (b * b));
        return hsp > 127.5;
    }

    /**
     * Updates the colors of player controls based on the primary color of the artwork.
     * @param {HTMLElement} playPauseBtn The play/pause button element.
     * @param {string} primaryColor The primary color string.
     */
    function updateControlColors(playPauseBtn, primaryColor) {
        const progressBar = page.querySelector("#lyrics-plus-progress-bar");
        if (progressBar) progressBar.style.backgroundColor = primaryColor;
        if (playPauseBtn) {
            playPauseBtn.style.backgroundColor = primaryColor;
            playPauseBtn.style.color = isColorLight(primaryColor) ? 'black' : 'white';
        }
    }

    /**
     * Extracts a palette of dominant colors from an image URL using the Median Cut algorithm.
     * @param {string} imageUrl The URL of the image.
     * @param {(colors: string[]) => void} callback The function to call with the array of color strings.
     * @param {number} [paletteSize=3] The number of dominant colors to extract.
     */
    function getDominantColors(imageUrl, callback, paletteSize = 3) {
        if (!imageUrl) {
            callback(['rgb(80,80,80)']);
            return;
        }
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.src = imageUrl;
        img.onload = () => {
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);

            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const pixels = [];
            // Get pixel data but skip transparent/white/black pixels for better results
            for (let i = 0; i < imageData.data.length; i += 4) {
                const r = imageData.data[i];
                const g = imageData.data[i + 1];
                const b = imageData.data[i + 2];
                const a = imageData.data[i + 3];
                if (a < 125 || (r > 250 && g > 250 && b > 250) || (r < 10 && g < 10 && b < 10)) {
                    continue;
                }
                pixels.push([r, g, b]);
            }

            if (pixels.length === 0) {
                 callback(['rgb(80,80,80)']);
                 return;
            }

            // --- Median Cut Algorithm ---
            const buckets = [pixels];

            while (buckets.length < paletteSize) {
                // Find the bucket with the greatest color range to split
                let bucketToSplit = buckets.shift();
                if (!bucketToSplit || bucketToSplit.length === 0) break;

                // Find the channel (R, G, or B) with the widest range
                let maxRange = -1;
                let channelIndex = -1;
                for (let i = 0; i < 3; i++) {
                    let min = 255, max = 0;
                    for (const pixel of bucketToSplit) {
                        min = Math.min(min, pixel[i]);
                        max = Math.max(max, pixel[i]);
                    }
                    const range = max - min;
                    if (range > maxRange) {
                        maxRange = range;
                        channelIndex = i;
                    }
                }

                // Sort the bucket by the channel with the widest range
                bucketToSplit.sort((a, b) => a[channelIndex] - b[channelIndex]);

                // Split the bucket at the median
                const mid = Math.floor(bucketToSplit.length / 2);
                buckets.push(bucketToSplit.slice(0, mid));
                buckets.push(bucketToSplit.slice(mid));
            }

            // Calculate the average color of each bucket
            const dominantColors = buckets.map(bucket => {
                if (bucket.length === 0) return 'rgb(80,80,80)';
                let r = 0, g = 0, b = 0;
                for (const pixel of bucket) {
                    r += pixel[0];
                    g += pixel[1];
                    b += pixel[2];
                }
                r = Math.floor(r / bucket.length);
                g = Math.floor(g / bucket.length);
                b = Math.floor(b / bucket.length);
                return `rgb(${r}, ${g}, ${b})`;
            });

            callback(dominantColors);
        };
        img.onerror = () => {
            callback(['rgb(80,80,80)']);
        };
    }
    
    // --- CACHING FUNCTIONS ---
    function getCache() {
        try {
            const cache = Spicetify.LocalStorage.get(CACHE_KEY);
            return cache ? JSON.parse(cache) : {};
        } catch (e) {
            console.error("[Lyrics+] Error reading cache, clearing it.", e);
            clearCache();
            return {};
        }
    }

    function saveCache(cache) {
        Spicetify.LocalStorage.set(CACHE_KEY, JSON.stringify(cache));
    }
    
    function clearCache() {
        Spicetify.LocalStorage.remove(CACHE_KEY);
    }

    function cacheCurrentSongLyrics() {
        if (!currentLyrics || !Player.data?.item) return;
        
        const trackUri = Player.data.item.uri;
        const cache = getCache();
        
        cache[trackUri] = {
            lyrics: currentLyrics,
            timestamp: Date.now()
        };
        
        saveCache(cache);
    }

    function clearCurrentSongCache() {
        const trackUri = Player.data?.item?.uri;
        if (!trackUri) return;

        const cache = getCache();
        if (cache[trackUri] && track.uri === latestFetchUri) {
            delete cache[trackUri];
            saveCache(cache);
        }
    }

    /**
     * Removes extra information from a string to improve search accuracy.
     * @param {string} text The text to clean.
     * @returns {string} The cleaned text.
     */
    function cleanText(text) {
        if (!text) return '';
        let cleanedText = text;

        // Remove specific phrases like "- Remastered 2023", "- Live at...", etc.
        cleanedText = cleanedText.replace(/\s-\s.*?(remaster|live|edit|version|mix|deluxe).*/i, '');

        // Remove anything in parentheses or brackets (often contains redundant info)
        cleanedText = cleanedText.replace(/\s*\(.*?\)\s*|\s*\[.*?\]\s*/g, '');

        // Remove featured artists
        cleanedText = cleanedText.replace(/\s(feat|ft)\..*/i, '');

        // Take only the primary artist if multiple are listed
        cleanedText = cleanedText.split(/,|\/|&|;/)[0];
        
        // Final trim to remove any leading/trailing spaces
        return cleanedText.trim();
    }
    
    /**
     * Generates a list of search permutations for a track.
     * @param {object} meta The track metadata.
     * @returns {Array<{title: string, artist: string, album: string}>}
     */
    function getSearchPermutations(meta) {
        const originalTitle = meta.title || '';
        const originalArtist = meta.artist_name || '';
        const originalAlbum = meta.album_title || '';

        const titleVariations = new Set([originalTitle, cleanText(originalTitle)]);
        const artistVariations = new Set([originalArtist, cleanText(originalArtist)]);
        const albumVariations = new Set([originalAlbum, cleanText(originalAlbum), '']);

        // Add individual artists to the set
        originalArtist.split(/,|\/|&|;|feat\.|ft\./i).forEach(artist => {
            const trimmedArtist = artist.trim();
            if (trimmedArtist) {
                artistVariations.add(trimmedArtist);
            }
        });

        const permutations = [];
        const addedPermutations = new Set();

        // Prioritized order of arrays
        const titles = Array.from(titleVariations);
        const artists = Array.from(artistVariations);
        const albums = Array.from(albumVariations);

        // Create all combinations, prioritizing more specific and original info first
        for (const title of titles) {
            for (const artist of artists) {
                for (const album of albums) {
                    const permutation = { title, artist, album };
                    const key = JSON.stringify(permutation);
                    if (!addedPermutations.has(key)) {
                        permutations.push(permutation);
                        addedPermutations.add(key);
                    }
                }
            }
        }
        return permutations;
    }


    /**
     * Fetches lyrics for the current track from the selected provider.
     * @param {object} track The current track object from Spicetify.
     */
    async function fetchLyrics(track) {
        // Cancel any previous in-progress fetch
        if (currentFetchController) {
            currentFetchController.abort();
        }
        currentFetchController = new AbortController();
        const { signal } = currentFetchController;

        if (!track?.uri) {
            currentLyrics = null;
            renderPageShell(null);
            renderLyricsContent(`No song playing.`);
            return;
        }

        // Mark this fetch as the latest one
        latestFetchUri = track.uri;


        if (page.dataset.uri === track.uri && currentLyrics) {
            updateLyricsUI(Player.getProgress());
            return;
        }

        page.dataset.uri = track.uri;
        currentLyrics = null;
        availableLyrics = [];
        currentActiveLineIndex = -1;
        lyricsStarted = false; // Reset for new song
        renderPageShell(track);
        updatePlayerControlsUI(Player.data);
        
        // Check cache first
        const trackUri = track.uri;
        const cache = getCache();
        if (cache[trackUri] && track.uri === latestFetchUri) {
            currentLyrics = cache[trackUri].lyrics;
            const contentHtml = currentLyrics.map(line => `<p class="lyrics-plus-line" data-time="${line.time}" data-text="${line.text.replace(/"/g, '&quot;')}">${line.text}</p>`).join('');
            renderLyricsContent(contentHtml);
            updateLyricsUI(Player.getProgress());
            updateStatusIndicator('online', 'Lyrics Found (Cached)');
            return;
        }

        renderLyricsContent(`Loading...`);
        updateStatusIndicator('checking', 'Loading...');

        const meta = track.metadata;
        const searchPermutations = getSearchPermutations(meta);
        let plainLyricsFallback = null;
        let providerIsReachable = false;
        const foundLyrics = new Set();

        for (const permutation of searchPermutations) {
            try {
                const url = `${LYRIC_PROVIDER_URL}?track_name=${encodeURIComponent(permutation.title)}&artist_name=${encodeURIComponent(permutation.artist)}&album_name=${encodeURIComponent(permutation.album)}&duration=${Math.round(Number(meta.duration) / 1000)}`;

                const response = await CosmosAsync.get(url, { signal });
                if (track.uri !== latestFetchUri) return;
                providerIsReachable = true;
                
                const syncedLyricsText = response.syncedLyrics;
                if (!plainLyricsFallback && response.plainLyrics) {
                    plainLyricsFallback = response.plainLyrics;
                }

                if (syncedLyricsText) {
                    const parsedLyrics = parseLRC(syncedLyricsText);
                    if (parsedLyrics && !foundLyrics.has(syncedLyricsText)) {
                        availableLyrics.push(parsedLyrics);
                        foundLyrics.add(syncedLyricsText);
                    }
                }
            } catch (err) {
                // This is expected for some permutations, so we don't log it.
            }
        }

        if (availableLyrics.length > 0) {
            currentLyrics = availableLyrics[0];
            if (currentConfig.autoCache) {
                cacheCurrentSongLyrics();
            }
            const contentHtml = currentLyrics.map(line => `<p class="lyrics-plus-line" data-time="${line.time}" data-text="${line.text.replace(/"/g, '&quot;')}">${line.text}</p>`).join('');
            renderLyricsContent(contentHtml);
            updateLyricsUI(Player.getProgress());
            updateStatusIndicator('online', `Found ${availableLyrics.length} version(s)`);
        } else if (plainLyricsFallback) {
            const plainHtml = plainLyricsFallback.split('\n').map(line => `<p class="lyrics-plus-line visible active">${line || '♪'}</p>`).join('');
            renderLyricsContent(plainHtml);
            updateStatusIndicator('not-found', 'No Synced Lyrics Found');
        } else if (providerIsReachable) {
            renderLyricsContent(`Lyrics not found.`);
            updateStatusIndicator('not-found', 'No Lyrics Found');
        } else {
            renderLyricsContent(`Lyrics provider seems to be offline.`);
            updateStatusIndicator('offline', 'Provider Offline');
        currentFetchController = null;
        }
    }

    /**
     * Parses LRC formatted text into an array of objects with time and text.
     * @param {string} lrcText The raw LRC text.
     * @returns {Array<{time: number, text: string}>|null}
     */
    function parseLRC(lrcText) {
        if (!lrcText) return null;
        const lines = lrcText.split("\n");
        const parsed = [];
        for (const line of lines) {
            const match = line.match(/\[(\d{2}):(\d{2})[.:](\d{2,3})\](.*)/);
            if (match) {
                const [, min, sec, ms, text] = match;
                const time = parseInt(min, 10) * 60000 + parseInt(sec, 10) * 1000 + parseInt(ms.padEnd(3, '0'), 10);
                parsed.push({ time, text: text.trim() || "♪" });
            }
        }
        return parsed.length > 0 ? parsed.sort((a, b) => a.time - b.time) : null;
    }

    /**
     * Formats milliseconds into a mm:ss time string.
     * @param {number} ms Milliseconds.
     * @returns {string}
     */
    function formatTime(ms) {
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60).toString();
        const seconds = (totalSeconds % 60).toString().padStart(2, '0');
        return `${minutes}:${seconds}`;
    }

    /**
     * Updates the player controls UI (play/pause button, progress bar, time).
     * @param {object} data The player data from Spicetify.
     */
    function updatePlayerControlsUI(data) {
        if (!isPageVisible) return;
        const playPauseBtn = page.querySelector('#lyrics-plus-play-pause-btn');
        const progressBar = page.querySelector('#lyrics-plus-progress-bar');
        const currentTimeEl = page.querySelector('#lyrics-plus-time-current');
        const totalTimeEl = page.querySelector('#lyrics-plus-time-total');

        if (!data || !playPauseBtn || !progressBar || !currentTimeEl || !totalTimeEl) return;

        playPauseBtn.innerHTML = data.is_playing ? 
            `<svg height="20" width="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 5V19M16 5V19" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>` : 
            `<svg height="20" width="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M16.6582 9.28638C18.098 10.1862 18.8178 10.6361 19.0647 11.2122C19.2803 11.7152 19.2803 12.2847 19.0647 12.7878C18.8178 13.3638 18.098 13.8137 16.6582 14.7136L9.896 18.94C8.29805 19.9387 7.49907 20.4381 6.83973 20.385C6.26501 20.3388 5.73818 20.0469 5.3944 19.584C5 19.053 5 18.1108 5 16.2264V7.77357C5 5.88919 5 4.94701 5.3944 4.41598C5.73818 3.9531 6.26501 3.66111 6.83973 3.6149C7.49907 3.5619 8.29805 4.06126 9.896 5.05998L16.6582 9.28638Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`;

        const progress = Player.getProgress();
        const duration = data.duration;
        currentTimeEl.textContent = formatTime(progress);
        totalTimeEl.textContent = formatTime(duration);
        progressBar.style.width = `${(progress / duration) * 100}%`;
    }

    /**
     * Updates the lyrics UI based on the current song progress.
     * @param {number} progressMs The current progress in milliseconds.
     */
    function updateLyricsUI(progressMs) {
        if (!isPageVisible) return;
        updatePlayerControlsUI(Player.data);
        if (!currentLyrics) return;

        const trackUri = Player.data?.item?.uri;
        const offset = getOffsetForTrack(trackUri);
        const adjustedProgressMs = progressMs - offset;

        let newActiveLineIndex = -1;
        for (let i = currentLyrics.length - 1; i >= 0; i--) {
            if (adjustedProgressMs >= currentLyrics[i].time) {
                newActiveLineIndex = i;
                break;
            }
        }

        if (newActiveLineIndex !== currentActiveLineIndex) {
            const lineElements = page.querySelectorAll('.lyrics-plus-line');
            if (!lineElements.length) return;
            
            const viewportEl = page.querySelector(".lyrics-plus-viewport");

            if (!lyricsStarted && newActiveLineIndex > -1) {
                lyricsStarted = true;
                if (viewportEl) {
                    viewportEl.classList.remove('lyrics-hidden');
                }
            }

            const oldActiveEl = lineElements[currentActiveLineIndex];
            if (oldActiveEl) {
                oldActiveEl.classList.remove('active');
                oldActiveEl.classList.add('past');
            }

            const newActiveEl = lineElements[newActiveLineIndex];
            if (newActiveEl) {
                newActiveEl.classList.remove('past');
                newActiveEl.classList.add('visible', 'active');
            }

            currentActiveLineIndex = newActiveLineIndex;

            // Animate scroll
            if (isSynced && newActiveEl && viewportEl) {
                 const contentEl = newActiveEl.parentElement;
                 if (contentEl) {
                    contentEl.style.transition = ''; // Re-enable CSS transition
                    const scrollOffset = newActiveEl.offsetTop - (viewportEl.clientHeight / 2) + (newActiveEl.clientHeight / 2);
                    contentEl.style.transform = `translateY(-${scrollOffset}px)`;
                 }
            }
        }
    }

    /**
     * Exports the current lyrics to an LRC file.
     */
    function exportLRC() {
        if (!currentLyrics || !Player.data?.item) {
            Spicetify.showNotification("No lyrics to export.", true);
            return;
        }

        const meta = Player.data.item.metadata;
        const trackUri = Player.data.item.uri;
        const offset = getOffsetForTrack(trackUri);

        let lrcContent = `[ar: ${meta.artist_name}]\n`;
        lrcContent += `[ti: ${meta.title}]\n`;
        lrcContent += `[al: ${meta.album_title}]\n`;
        lrcContent += `[offset: ${offset}]\n\n`;

        currentLyrics.forEach(line => {
            const time = line.time + offset;
            const minutes = Math.floor(time / 60000).toString().padStart(2, '0');
            const secondsWithMs = (time % 60000) / 1000;
            const seconds = Math.floor(secondsWithMs).toString().padStart(2, '0');
            const milliseconds = Math.round((secondsWithMs - Math.floor(secondsWithMs)) * 100).toString().padEnd(2, '0');
            lrcContent += `[${minutes}:${seconds}.${milliseconds}]${line.text}\n`;
        });

        const blob = new Blob([lrcContent], { type: 'text/plain;charset=utf-8' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${meta.artist_name} - ${meta.title}.lrc`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }


    // --- EVENT LISTENERS & INITIALIZATION ---
    Player.addEventListener("songchange", (event) => {
        if (currentFetchController) {
            currentFetchController.abort();
        }
        fetchLyrics(event.data.item);
        updatePlayerControlsUI(event.data);
    });

    Player.addEventListener("onprogress", (event) => {
        if (isPageVisible) {
            updateLyricsUI(event.data);
        }
    });

    Player.addEventListener("onplaypause", (event) => {
        if (isPageVisible) {
            updatePlayerControlsUI(Player.data);
        }
    });
    // Initial setup
    createSettingsModal();
    loadConfig();
    loadOffsets();
    if (Player.data && Player.data.item) {
        renderPageShell(Player.data.item);
        fetchLyrics(Player.data.item);
    }


    // Add context menu option to cache all lyrics in a playlist/album
    ContextMenu.registerItem({
        label: "Cache All Lyrics",
        condition: (uri) => uri?.startsWith("spotify:playlist:") || uri?.startsWith("spotify:album:"),
        onClick: async (uri) => {
            Spicetify.showNotification("Caching lyrics...");
            try {
                const items = await Spicetify.CosmosAsync.get(`sp://core-playlist/v1/playlist/${uri}/rows`);
                for (const item of items.rows) {
                    const track = item?.item?.metadata;
                    if (track) {
                        await fetchLyrics({ metadata: track, uri: item.item.uri });
                        cacheCurrentSongLyrics();
                    }
                }
                Spicetify.showNotification("All lyrics cached!");
            } catch (e) {
                console.error("[Lyrics+] Failed to cache all lyrics", e);
                Spicetify.showNotification("Error caching lyrics", true);
            }
        }
    });

})();


/* ===== Lyrics Plus: Queue Prefetch (silent) + Up Next (fade, fixed async) ===== */
(async function () {
    if (!window.Spicetify) return;

    function getFirstDefined(...vals) {
        for (const v of vals) if (v !== undefined && v !== null && v !== "") return v;
        return undefined;
    }

    function toMetaFromQueueItem(q) {
        if (!q) return {};
        const meta = {
            title: getFirstDefined(q?.metadata?.title, q?.name, q?.contextTrack?.metadata?.title) || "",
            artist_name: getFirstDefined(
                q?.metadata?.artist_name,
                Array.isArray(q?.artists) ? q.artists.map(a => a?.name).filter(Boolean).join(", ") : undefined,
                Array.isArray(q?.contextTrack?.artists) ? q.contextTrack.artists.map(a => a?.name).filter(Boolean).join(", ") : undefined,
                q?.artist
            ) || "",
            album_title: getFirstDefined(q?.metadata?.album_title, q?.album?.name, q?.contextTrack?.album?.name, "") || "",
            duration: Number(getFirstDefined(q?.metadata?.duration, q?.duration, q?.contextTrack?.metadata?.duration, 0)) || 0,
            image_url: getFirstDefined(
                q?.metadata?.image_url,
                q?.image_url,
                q?.image,
                (Array.isArray(q?.album?.images) && q.album.images[0]?.url),
                (Array.isArray(q?.images) && q.images[0]?.url)
            ) || ""
        };
        return meta;
    }

    function toUri(q) {
        return getFirstDefined(q?.uri, q?.contextTrack?.uri, q?.context_uri);
    }

    async function getQueue() {
        try {
            if (Spicetify.Queue && Array.isArray(Spicetify.Queue.nextTracks)) {
                return Spicetify.Queue.nextTracks;
            }
        } catch {}
        try {
            const resp = await Spicetify.Platform.PlayerAPI.getQueue();
            return resp?.queue || [];
        } catch {
            return [];
        }
    }

    function getCache() {
        try {
            const raw = Spicetify.LocalStorage.get("lyrics-plus:cache");
            return raw ? JSON.parse(raw) : {};
        } catch {
            return {};
        }
    }
    function saveCache(cache) {
        Spicetify.LocalStorage.set("lyrics-plus:cache", JSON.stringify(cache));
    }
    function cacheLyricsForUri(uri, lyricsArray) {
        if (!uri || !Array.isArray(lyricsArray) || !lyricsArray.length) return;
        const cache = getCache();
        cache[uri] = { lyrics: lyricsArray, timestamp: Date.now() };
        saveCache(cache);
    }

    function parseLRC(lrcText) {
        if (!lrcText) return null;
        const lines = String(lrcText).split("\n");
        const parsed = [];
        for (const line of lines) {
            const m = line.match(/\[(\d{2}):(\d{2})[.:](\d{2,3})\](.*)/);
            if (m) {
                const [, min, sec, ms, text] = m;
                const t = parseInt(min, 10) * 60000 + parseInt(sec, 10) * 1000 + parseInt(String(ms).padEnd(3, "0"), 10);
                parsed.push({ time: t, text: (text || "").trim() || "♪" });
            }
        }
        return parsed.length ? parsed.sort((a,b)=>a.time-b.time) : null;
    }

    async function silentFetchAndCache(queueItem) {
        try {
            const uri = toUri(queueItem);
            if (!uri) return;
            const existing = getCache();
            if (existing[uri]?.lyrics?.length) return;
            const meta = toMetaFromQueueItem(queueItem);
            if (!meta.title || !meta.artist_name) return;
            const url = `https://lrclib.net/api/get?track_name=${encodeURIComponent(meta.title)}&artist_name=${encodeURIComponent(meta.artist_name)}&album_name=${encodeURIComponent(meta.album_title)}&duration=${Math.round(meta.duration/1000)}`;
            const resp = await Spicetify.CosmosAsync.get(url);
            let parsed = null;
            if (resp?.syncedLyrics) parsed = parseLRC(resp.syncedLyrics);
            if (!parsed && resp?.plainLyrics) {
                const lines = String(resp.plainLyrics).split("\n").map((t,i)=>({time:i*2000,text:t||"♪"}));
                if (lines.length) parsed = lines;
            }
            if (parsed?.length) cacheLyricsForUri(uri, parsed);
        } catch {}
    }

    async function prefetchQueueLyricsSilently() {
        try {
            const queue = await getQueue();
            for (const item of queue) {
                await silentFetchAndCache(item);
                await new Promise(r => setTimeout(r, 150));
            }
        } catch {}
    }

    if (typeof window.fetchLyrics === "function" && !window.fetchLyrics.__lp_prefetchHooked) {
        const _orig = window.fetchLyrics;
        window.fetchLyrics = async function(...args) {
            const r = await _orig.apply(this, args);
            prefetchQueueLyricsSilently();
            return r;
        };
        window.fetchLyrics.__lp_prefetchHooked = true;
    }
    try { Spicetify.Player.addEventListener("songchange", prefetchQueueLyricsSilently); } catch {}

    function isFullscreenVisible() {
        const el = document.getElementById("lyrics-plus-fullscreen-container");
        return !!(el && el.classList.contains("visible"));
    }

    function ensureUpNextUI() {
        let el = document.getElementById("lyrics-plus-upnext");
        if (!el) {
            el = document.createElement("div");
            el.id = "lyrics-plus-upnext";
            el.style.position = "fixed";
            el.style.top = "80px";
            el.style.right = "20px";
            el.style.background = "rgba(0,0,0,0.8)";
            el.style.backdropFilter = "blur(6px)";
            el.style.borderRadius = "14px";
            el.style.padding = "10px 12px";
            el.style.alignItems = "center";
            el.style.gap = "10px";
            el.style.color = "white";
            el.style.fontSize = "14px";
            el.style.maxWidth = "360px";
            el.style.zIndex = "10010";
            el.style.boxShadow = "0 6px 24px rgba(0,0,0,0.4)";
            el.style.pointerEvents = "none";
            el.style.opacity = "0";
            el.style.transition = "opacity 0.4s ease-in-out";

            const icon = document.createElement("div");
            icon.id = "lyrics-plus-upnext-icon";
            icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M3 6h13v2H3V6zm0 5h13v2H3v-2zm0 5h9v2H3v-2zm14-4l5 4-5 4v-8z"/></svg>';
            icon.style.opacity = "0.9";
            icon.style.flexShrink = "0";

            const img = document.createElement("img");
            img.id = "lyrics-plus-upnext-img";
            img.style.width = "46px";
            img.style.height = "46px";
            img.style.borderRadius = "8px";
            img.style.objectFit = "cover";
            img.style.flexShrink = "0";
            img.alt = "Cover Art";

            const wrap = document.createElement("div");
            wrap.style.overflow = "hidden";
            wrap.style.display = "flex";
            wrap.style.flexDirection = "column";

            const label = document.createElement("div");
            label.textContent = "UP NEXT";
            label.style.opacity = "0.8";
            label.style.fontSize = "11px";
            label.style.letterSpacing = "0.06em";

            const title = document.createElement("div");
            title.id = "lyrics-plus-upnext-title";
            title.style.fontWeight = "700";
            title.style.whiteSpace = "nowrap";
            title.style.overflow = "hidden";
            title.style.textOverflow = "ellipsis";

            const artist = document.createElement("div");
            artist.id = "lyrics-plus-upnext-artist";
            artist.style.opacity = "0.9";
            artist.style.whiteSpace = "nowrap";
            artist.style.overflow = "hidden";
            artist.style.textOverflow = "ellipsis";

            wrap.appendChild(label);
            wrap.appendChild(title);
            wrap.appendChild(artist);

            el.appendChild(icon);
            el.appendChild(img);
            el.appendChild(wrap);
            document.body.appendChild(el);
        }
        return el;
    }

    async function updateUpNextOverlay() {
        const el = ensureUpNextUI();
        try {
            if (!isFullscreenVisible()) { el.style.opacity = "0"; return; }

            const data = Spicetify.Player?.data;
            const duration = Number(data?.duration || 0);
            if (!duration) { el.style.opacity = "0"; return; }

            const progress = Spicetify.Player.getProgress();
            const remaining = duration - progress;
            if (remaining > 15000) { el.style.opacity = "0"; return; }

            const queue = await getQueue();
            const next = queue?.[0];
            if (!next) { el.style.opacity = "0"; return; }

            const meta = toMetaFromQueueItem(next);
            const img = el.querySelector("#lyrics-plus-upnext-img");
            const title = el.querySelector("#lyrics-plus-upnext-title");
            const artist = el.querySelector("#lyrics-plus-upnext-artist");

            if (img) {
                img.src = meta.image_url || "";
                img.style.display = meta.image_url ? "block" : "none";
            }
            if (title) title.textContent = meta.title || "";
            if (artist) artist.textContent = meta.artist_name || "";

            el.style.opacity = "1";
        } catch {
            el.style.opacity = "0";
        }
    }

    try {
        Spicetify.Player.addEventListener("onprogress", () => updateUpNextOverlay());
        Spicetify.Player.addEventListener("songchange", () => updateUpNextOverlay());
    } catch {}
})();
/* ===== End of addon ===== */
