try {
  require('dotenv').config();
} catch (err) {
  // dotenv not installed / no .env file — fine in production where env vars are set directly
}

const app = require('./expressApp');

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Personalplanering körs på port ${PORT}`);
});
