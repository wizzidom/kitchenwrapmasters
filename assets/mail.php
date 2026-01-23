<?php
$name = $_POST['name'];
$email = $_POST['email'];
$phone = $_POST['phone'];
$subject = $_POST['subject'];
$message = $_POST['message'];

$email_message = "
New Contact Form Submission from Kitchen Wrap Masters Website

Name: ".$name."
Email: ".$email."
Phone: ".$phone."
Subject: ".$subject."
Message: ".$message."

";

$to = "majolawisdom@gmail.com";
$email_subject = "New Contact Form - Kitchen Wrap Masters";
$headers = "From: " . $email . "\r\n";
$headers .= "Reply-To: " . $email . "\r\n";
$headers .= "Content-Type: text/plain; charset=UTF-8\r\n";

if(mail($to, $email_subject, $email_message, $headers)) {
    header("location: ../pages/contact.html?success=1");
} else {
    header("location: ../pages/contact.html?error=1");
}
?>


