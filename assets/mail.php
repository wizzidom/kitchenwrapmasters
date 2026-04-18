<?php
if ($_SERVER["REQUEST_METHOD"] == "POST") {

    $to = "wiseman@kitchenwrapmasters.co.za";
    $subject = "New Live Quotation Booking";

    $name = $_POST["name"] ?? "";
    $email = $_POST["email"] ?? "";
    $phone = $_POST["phone"] ?? "";
    $message = $_POST["message"] ?? "";

    $body  = "New quotation request:\n\n";
    $body .= "Name: $name\n";
    $body .= "Email: $email\n";
    $body .= "Phone: $phone\n\n";
    $body .= "Message:\n$message";

    $headers = "From: $email";

    mail($to, $subject, $body, $headers);
}
?>

<!DOCTYPE html>
<html>
<head>
  <title>Message Sent</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      background: #f9f9f9;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
    }
    .success-box {
      background: #fff;
      padding: 30px;
      border-radius: 8px;
      text-align: center;
      box-shadow: 0 5px 15px rgba(0,0,0,0.1);
    }
    .success-box h2 {
      color: #2e7d32;
      margin-bottom: 10px;
    }
  </style>
</head>
<body>
  <div class="success-box">
    <h2>Message Sent Successfully</h2>
    <p>Thank you. We will contact you shortly via SMS or email.</p>
  </div>
</body>
</html>
