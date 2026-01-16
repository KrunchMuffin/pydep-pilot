// @ts-check

(function () {
    // @ts-ignore
    const vscode = acquireVsCodeApi();

    /** @type {Array<{name: string, version: string, latestVersion?: string}>} */
    let packages = [];

    /** @type {Set<string>} */
    let selectedPackages = new Set();

    /** @type {string} */
    let searchFilter = '';

    /** @type {boolean} */
    let isLoading = false;

    /** @type {boolean} */
    let hasRequirements = false;

    /** @type {string|null} */
    let errorMessage = null;

    /** @type {boolean} */
    let isCheckingUpdates = false;

    // DOM Elements
    const packageListEl = document.getElementById('package-list');
    const searchInputEl = document.getElementById('search-input');
    const selectAllCheckboxEl = document.getElementById('select-all-checkbox');
    const updateSelectedBtnEl = document.getElementById('update-selected-btn');
    const selectedCountEl = document.getElementById('selected-count');
    const totalCountEl = document.getElementById('total-count');
    const updateAvailableCountEl = document.getElementById('update-available-count');
    const refreshBtnEl = document.getElementById('refresh-btn');
    const addBtnEl = document.getElementById('add-btn');
    const searchPypiBtnEl = document.getElementById('search-pypi-btn');
    const exportBtnEl = document.getElementById('export-btn');

    // Initialize
    init();

    function init() {
        // Event listeners
        searchInputEl?.addEventListener('input', handleSearchInput);
        selectAllCheckboxEl?.addEventListener('change', handleSelectAll);
        updateSelectedBtnEl?.addEventListener('click', handleUpdateSelected);
        refreshBtnEl?.addEventListener('click', handleRefresh);
        addBtnEl?.addEventListener('click', handleAddPackage);
        searchPypiBtnEl?.addEventListener('click', handleSearchPyPI);
        exportBtnEl?.addEventListener('click', handleExportRequirements);

        // Listen for messages from extension
        window.addEventListener('message', handleMessage);
    }

    /**
     * @param {MessageEvent} event
     */
    function handleMessage(event) {
        const message = event.data;

        switch (message.type) {
            case 'packages':
                const wasEmpty = packages.length === 0;
                packages = message.data || [];
                hasRequirements = message.hasRequirements || false;
                errorMessage = null;
                // Only clear selections on fresh load, not incremental updates
                if (wasEmpty) {
                    selectedPackages.clear();
                }
                render();
                break;

            case 'loading':
                isLoading = message.value;
                if (isLoading) {
                    showLoading();
                }
                break;

            case 'error':
                errorMessage = message.message;
                packages = [];
                render();
                break;

            case 'progress':
                // Could show progress indicator in UI
                break;

            case 'checkingUpdates':
                isCheckingUpdates = message.value;
                render();  // Re-render to show/hide spinners
                break;

            case 'updateComplete':
                selectedPackages.clear();
                updateSelectionUI();
                break;
        }
    }

    function showLoading() {
        if (!packageListEl) return;
        packageListEl.textContent = '';

        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'loading-message';

        const spinner = document.createElement('span');
        spinner.className = 'loading-spinner';
        loadingDiv.appendChild(spinner);

        const text = document.createTextNode(' Loading packages...');
        loadingDiv.appendChild(text);

        packageListEl.appendChild(loadingDiv);
    }

    function render() {
        if (!packageListEl) return;

        const filteredPackages = getFilteredPackages();
        packageListEl.textContent = '';

        // Show error state
        if (errorMessage) {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'empty-message error-state';

            const iconSpan = document.createElement('span');
            iconSpan.className = 'codicon codicon-warning';
            iconSpan.style.fontSize = '24px';
            iconSpan.style.marginBottom = '8px';
            errorDiv.appendChild(iconSpan);

            const msgDiv = document.createElement('div');
            msgDiv.textContent = errorMessage;
            errorDiv.appendChild(msgDiv);

            // Add "Select Python Interpreter" button if it's a Python error
            if (errorMessage.includes('Python')) {
                const btn = document.createElement('button');
                btn.className = 'primary-btn';
                btn.style.marginTop = '12px';
                btn.textContent = 'Select Python Interpreter';
                btn.addEventListener('click', () => {
                    vscode.postMessage({ type: 'selectPython' });
                });
                errorDiv.appendChild(btn);
            }

            packageListEl.appendChild(errorDiv);
            updateFooter();
            return;
        }

        // Show empty state
        if (filteredPackages.length === 0) {
            const emptyDiv = document.createElement('div');
            emptyDiv.className = 'empty-message';

            if (packages.length === 0) {
                const iconSpan = document.createElement('span');
                iconSpan.className = 'codicon codicon-package';
                iconSpan.style.fontSize = '24px';
                iconSpan.style.marginBottom = '8px';
                iconSpan.style.opacity = '0.6';
                emptyDiv.appendChild(iconSpan);

                const msgDiv = document.createElement('div');
                msgDiv.textContent = 'No packages installed';
                emptyDiv.appendChild(msgDiv);

                if (hasRequirements) {
                    const hintDiv = document.createElement('div');
                    hintDiv.style.marginTop = '8px';
                    hintDiv.style.fontSize = '12px';
                    hintDiv.style.opacity = '0.8';
                    hintDiv.textContent = 'Found requirements.txt in workspace';
                    emptyDiv.appendChild(hintDiv);

                    const btn = document.createElement('button');
                    btn.className = 'primary-btn';
                    btn.style.marginTop = '12px';
                    btn.textContent = 'Install from requirements.txt';
                    btn.addEventListener('click', () => {
                        vscode.postMessage({ type: 'installRequirements' });
                    });
                    emptyDiv.appendChild(btn);
                } else {
                    const hintDiv = document.createElement('div');
                    hintDiv.style.marginTop = '8px';
                    hintDiv.style.fontSize = '12px';
                    hintDiv.style.opacity = '0.8';
                    hintDiv.textContent = 'Use the + button to add packages';
                    emptyDiv.appendChild(hintDiv);
                }
            } else {
                emptyDiv.textContent = 'No packages match your filter';
            }

            packageListEl.appendChild(emptyDiv);
        } else {
            filteredPackages.forEach(pkg => {
                const row = createPackageRowElement(pkg);
                packageListEl.appendChild(row);
            });
        }

        updateFooter();
        updateSelectionUI();
    }

    function getFilteredPackages() {
        if (!searchFilter) {
            return packages;
        }
        const filter = searchFilter.toLowerCase();
        return packages.filter(pkg => pkg.name.toLowerCase().includes(filter));
    }

    /**
     * Creates a package row element using safe DOM methods
     * @param {{name: string, version: string, latestVersion?: string}} pkg
     * @returns {HTMLElement}
     */
    function createPackageRowElement(pkg) {
        const hasUpdate = pkg.latestVersion && pkg.latestVersion !== pkg.version;
        const isSelected = selectedPackages.has(pkg.name);

        const row = document.createElement('div');
        row.className = 'package-row' + (hasUpdate ? ' has-update' : '') + (isSelected ? ' selected' : '');
        row.dataset.name = pkg.name;

        // Checkbox column
        const checkboxCol = document.createElement('div');
        checkboxCol.className = 'col-checkbox';
        const checkboxLabel = document.createElement('label');
        checkboxLabel.className = 'checkbox-container';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'package-checkbox';
        checkbox.dataset.name = pkg.name;
        checkbox.checked = isSelected;
        checkbox.disabled = !hasUpdate;
        checkbox.addEventListener('change', handleCheckboxChange);
        checkboxLabel.appendChild(checkbox);
        checkboxCol.appendChild(checkboxLabel);
        row.appendChild(checkboxCol);

        // Name column
        const nameCol = document.createElement('div');
        nameCol.className = 'col-name';
        const nameSpan = document.createElement('span');
        nameSpan.className = 'package-name';
        nameSpan.dataset.name = pkg.name;
        nameSpan.title = 'Open on PyPI';
        nameSpan.textContent = pkg.name;
        nameSpan.addEventListener('click', handlePackageNameClick);
        nameCol.appendChild(nameSpan);
        row.appendChild(nameCol);

        // Version column
        const versionCol = document.createElement('div');
        versionCol.className = 'col-version';
        versionCol.textContent = pkg.version;
        row.appendChild(versionCol);

        // Latest version column
        const latestCol = document.createElement('div');
        latestCol.className = 'col-latest' + (hasUpdate ? ' has-update' : '');

        if (isCheckingUpdates && !pkg.latestVersion) {
            // Show spinner while checking
            const spinner = document.createElement('span');
            spinner.className = 'checking-spinner';
            latestCol.appendChild(spinner);
        } else if (pkg.latestVersion) {
            // Make version clickable to pick a specific version
            const versionLink = document.createElement('span');
            versionLink.className = 'version-picker';
            versionLink.textContent = pkg.latestVersion;
            versionLink.dataset.name = pkg.name;
            versionLink.dataset.version = pkg.version;
            versionLink.title = 'Click to pick a specific version';
            versionLink.addEventListener('click', handlePickVersion);
            latestCol.appendChild(versionLink);
        } else {
            latestCol.textContent = '-';
        }
        row.appendChild(latestCol);

        // Status column
        const statusCol = document.createElement('div');
        statusCol.className = 'col-status';
        const statusBadge = document.createElement('span');

        if (isCheckingUpdates && !pkg.latestVersion) {
            statusBadge.className = 'status-badge checking';
            statusBadge.textContent = 'Checking';
        } else if (hasUpdate) {
            statusBadge.className = 'status-badge outdated';
            statusBadge.textContent = 'Outdated';
        } else {
            statusBadge.className = 'status-badge current';
            statusBadge.textContent = 'Current';
        }
        statusCol.appendChild(statusBadge);
        row.appendChild(statusCol);

        // Actions column
        const actionsCol = document.createElement('div');
        actionsCol.className = 'col-actions';

        if (hasUpdate) {
            const updateBtn = document.createElement('button');
            updateBtn.className = 'action-btn update-btn';
            updateBtn.dataset.name = pkg.name;
            updateBtn.title = 'Update';
            const updateIcon = document.createElement('span');
            updateIcon.className = 'codicon codicon-arrow-up';
            updateBtn.appendChild(updateIcon);
            updateBtn.addEventListener('click', handleUpdateSingle);
            actionsCol.appendChild(updateBtn);
        }

        const removeBtn = document.createElement('button');
        removeBtn.className = 'action-btn remove-btn';
        removeBtn.dataset.name = pkg.name;
        removeBtn.title = 'Remove';
        const removeIcon = document.createElement('span');
        removeIcon.className = 'codicon codicon-trash';
        removeBtn.appendChild(removeIcon);
        removeBtn.addEventListener('click', handleRemove);
        actionsCol.appendChild(removeBtn);

        row.appendChild(actionsCol);

        return row;
    }

    /**
     * @param {Event} e
     */
    function handleCheckboxChange(e) {
        const checkbox = /** @type {HTMLInputElement} */ (e.target);
        const name = checkbox.dataset.name;

        if (!name) return;

        if (checkbox.checked) {
            selectedPackages.add(name);
        } else {
            selectedPackages.delete(name);
        }

        updateSelectionUI();
    }

    /**
     * @param {Event} e
     */
    function handlePackageNameClick(e) {
        const el = /** @type {HTMLElement} */ (e.target);
        const name = el.dataset.name;
        if (name) {
            vscode.postMessage({ type: 'openPyPI', payload: name });
        }
    }

    /**
     * @param {Event} e
     */
    function handleUpdateSingle(e) {
        const btn = /** @type {HTMLElement} */ (e.currentTarget);
        const name = btn.dataset.name;
        if (name) {
            vscode.postMessage({ type: 'updateSingle', payload: name });
        }
    }

    /**
     * @param {Event} e
     */
    function handleRemove(e) {
        const btn = /** @type {HTMLElement} */ (e.currentTarget);
        const name = btn.dataset.name;
        if (name) {
            vscode.postMessage({ type: 'remove', payload: name });
        }
    }

    /**
     * @param {Event} e
     */
    function handleSearchInput(e) {
        const input = /** @type {HTMLInputElement} */ (e.target);
        searchFilter = input.value;
        render();
    }

    /**
     * @param {Event} e
     */
    function handleSelectAll(e) {
        const checkbox = /** @type {HTMLInputElement} */ (e.target);
        const packagesWithUpdates = packages.filter(pkg =>
            pkg.latestVersion && pkg.latestVersion !== pkg.version
        );

        if (checkbox.checked) {
            packagesWithUpdates.forEach(pkg => selectedPackages.add(pkg.name));
        } else {
            selectedPackages.clear();
        }

        render();
    }

    function handleUpdateSelected() {
        if (selectedPackages.size === 0) return;

        vscode.postMessage({
            type: 'updateSelected',
            payload: Array.from(selectedPackages)
        });
    }

    function handleRefresh() {
        vscode.postMessage({ type: 'refresh' });
    }

    function handleAddPackage() {
        vscode.postMessage({ type: 'addPackage' });
    }

    function handleSearchPyPI() {
        vscode.postMessage({ type: 'searchPackage' });
    }

    function handleExportRequirements() {
        vscode.postMessage({ type: 'exportRequirements' });
    }

    /**
     * @param {Event} e
     */
    function handlePickVersion(e) {
        const el = /** @type {HTMLElement} */ (e.target);
        const name = el.dataset.name;
        const version = el.dataset.version;
        if (name) {
            vscode.postMessage({ type: 'pickVersion', payload: { name, version } });
        }
    }

    function updateSelectionUI() {
        const count = selectedPackages.size;

        if (selectedCountEl) {
            selectedCountEl.textContent = String(count);
        }

        if (updateSelectedBtnEl) {
            /** @type {HTMLButtonElement} */ (updateSelectedBtnEl).disabled = count === 0;
        }

        // Update select all checkbox state
        const packagesWithUpdates = packages.filter(pkg =>
            pkg.latestVersion && pkg.latestVersion !== pkg.version
        );

        if (selectAllCheckboxEl) {
            const allSelected = packagesWithUpdates.length > 0 &&
                packagesWithUpdates.every(pkg => selectedPackages.has(pkg.name));
            const someSelected = packagesWithUpdates.some(pkg => selectedPackages.has(pkg.name));

            /** @type {HTMLInputElement} */ (selectAllCheckboxEl).checked = allSelected;
            /** @type {HTMLInputElement} */ (selectAllCheckboxEl).indeterminate = someSelected && !allSelected;
        }
    }

    function updateFooter() {
        const total = packages.length;
        const updatable = packages.filter(pkg =>
            pkg.latestVersion && pkg.latestVersion !== pkg.version
        ).length;

        if (totalCountEl) {
            totalCountEl.textContent = total + ' package' + (total !== 1 ? 's' : '');
        }

        if (updateAvailableCountEl) {
            // Clear existing content
            updateAvailableCountEl.textContent = '';

            if (isCheckingUpdates) {
                updateAvailableCountEl.textContent = 'Checking for updates...';
                updateAvailableCountEl.classList.add('checking');
            } else {
                updateAvailableCountEl.classList.remove('checking');
                if (updatable > 0) {
                    const icon = document.createElement('span');
                    icon.className = 'codicon codicon-arrow-up';
                    icon.style.marginRight = '4px';
                    updateAvailableCountEl.appendChild(icon);
                    updateAvailableCountEl.appendChild(document.createTextNode(
                        updatable + ' update' + (updatable !== 1 ? 's' : '') + ' available'
                    ));
                }
            }
        }
    }
})();
