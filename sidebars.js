const sidebars = {
  docs: [
    {
      type: 'category',
      label: 'Troubleshooting',
      collapsed: false,
      items: [
        'troubleshooting/timeout-misdiagnosis',
        'troubleshooting/silent-tool-failure',
        'troubleshooting/context-saturation',
      ],
    },
    {
      type: 'category',
      label: 'Engineering',
      collapsed: false,
      items: [
        'engineering/soul-md-engineering',
        'engineering/example-drift',
      ],
    },
    {
      type: 'category',
      label: 'Articles',
      collapsed: false,
      items: [
        'articles/ai-agent-24hr-employee-reality',
      ],
    },
  ],
};

module.exports = sidebars;
