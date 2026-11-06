const { app } = require('@azure/functions');

app.http('studyData', {
  route: 'study-data',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async () => ({
    jsonBody: {
      ok: true,
      message: '语间的云端接口已连接'
    }
  })
});
