export default (req, res) => {
  res.statusCode = 503;
  res.end("API not built");
};
