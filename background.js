async function enableSidePanel() {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (error) {
    console.warn('Side panel behavior failed', error);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  enableSidePanel();
});

chrome.runtime.onStartup.addListener(() => {
  enableSidePanel();
});
