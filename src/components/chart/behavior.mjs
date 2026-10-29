planUI.define("chart", {
  match: "[data-chart]",
  setup(element, { planUI }) {
    const options = JSON.parse(element.textContent);
    element.textContent = "";
    if (element.dataset.title || element.dataset.caption)
      figure(element, {
        title: element.dataset.title,
        caption: element.dataset.caption,
        kind: "chart",
      });
    // The chart renders into a box of fixed height, so setup does not wait for
    // ECharts.
    planUI.chart(element, options).catch((error) => {
      element.textContent = JSON.stringify(options, null, 2);
      failed(element, error);
    });
  },
});
