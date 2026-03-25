const axios = require("axios");

async function testAdminLogin() {
	try {
		const response = await axios.post("http://localhost:4000/api/admin/login", {
			username: "admin",
			password: "admin",
		});
		console.log("Login successful:", response.data);
	} catch (error) {
		console.error("Login failed:", error.response ? error.response.data : error.message);
	}
}

testAdminLogin();
