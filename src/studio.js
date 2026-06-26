/**
 * Motion Capture studio shell:
 * - Tab switching: Intake | Media Lab
 * - Queue sidebar toggle
 */

export function initStudio() {
  const tabIntake = document.getElementById('tab-intake');
  const tabMediaLab = document.getElementById('tab-media-lab');
  const panelIntake = document.getElementById('panel-intake');
  const panelMediaLab = document.getElementById('panel-media-lab');
  const queueToggleBtn = document.getElementById('queue-toggle-btn');
  const queueSidebar = document.getElementById('queue-sidebar');

  if (!tabIntake || !tabMediaLab) return;

  function activateTab(name) {
    if (name === 'intake') {
      tabIntake.classList.add('is-active');
      tabMediaLab.classList.remove('is-active');
      if (panelIntake) panelIntake.hidden = false;
      if (panelMediaLab) panelMediaLab.hidden = true;
    } else {
      tabMediaLab.classList.add('is-active');
      tabIntake.classList.remove('is-active');
      if (panelMediaLab) panelMediaLab.hidden = false;
      if (panelIntake) panelIntake.hidden = true;
    }
  }

  tabIntake.addEventListener('click', () => activateTab('intake'));
  tabMediaLab.addEventListener('click', () => activateTab('media-lab'));

  // Default: Intake tab active
  activateTab('intake');

  // Queue sidebar toggle
  if (queueToggleBtn && queueSidebar) {
    queueToggleBtn.addEventListener('click', () => {
      const isOpen = !queueSidebar.hidden;
      queueSidebar.hidden = isOpen;
      queueToggleBtn.setAttribute('aria-expanded', String(!isOpen));
    });
  }
}
