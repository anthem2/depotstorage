const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (_req, res) => {
  res.status(200).send('ok');
});

app.listen(PORT, () => {
  console.log(`Depot Storage site running on port ${PORT}`);
});
