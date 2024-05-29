import { db } from "@/db";
import { stripe } from "@/lib/stripe";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import Stripe from "stripe";
// import { Resend } from "resend";
import sgMail from "@sendgrid/mail";
import OrderReceivedEmail from "@/components/emails/OrderReceivedEmail";
import { render } from "@react-email/render";

// const resend = new Resend(process.env.RESEND_API_KEY);
const sendGridApiKey = process.env.SENDGRID_API_KEY;

if (!sendGridApiKey) {
  throw new Error("SENDGRID_API_KEY is not defined");
}

sgMail.setApiKey(sendGridApiKey);

export async function POST(req: Request) {
  try {
    const body = await req.text();
    console.log("Request Body:", body); // Log the request body

    const signature = headers().get("stripe-signature");
    console.log("Stripe Signature:", signature); // Log the stripe signature

    if (!signature) {
      console.log("Invalid signature"); // Log if the signature is missing
      return new Response("Invalid signature", { status: 400 });
    }

    const event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );

    console.log("Webhook Event:", event); // Log the webhook event

    if (event.type === "checkout.session.completed") {
      if (!event.data.object.customer_details?.email) {
        console.log("Missing user email"); // Log if user email is missing
        throw new Error("Missing user email");
      }

      const session = event.data.object as Stripe.Checkout.Session;
      const { userId, orderId } = session.metadata || {
        userId: null,
        orderId: null,
      };

      if (!userId || !orderId) {
        throw new Error("Invalid request metadata");
      }

      const billingAddress = session.customer_details!.address;
      const shippingAddress = session.shipping_details!.address;

      const updatedOrder = await db.order.update({
        where: {
          id: orderId,
        },
        data: {
          isPaid: true,
          shippingAddress: {
            create: {
              name: session.customer_details!.name!,
              city: shippingAddress!.city!,
              country: shippingAddress!.country!,
              postalCode: shippingAddress!.postal_code!,
              street: shippingAddress!.line1!,
              state: shippingAddress!.state!,
            },
          },
          billingAddress: {
            create: {
              name: session.customer_details!.name!,
              city: billingAddress!.city!,
              country: billingAddress!.country!,
              postalCode: billingAddress!.postal_code!,
              street: billingAddress!.line1!,
              state: billingAddress!.state!,
            },
          },
        },
      });

      // await resend.emails.send({
      //   from: "CaseCrafter <yeminghuhym@gmail.com>",
      //   to: [event.data.object.customer_details.email],
      //   subject: "Thanks for your order!",
      //   react: OrderReceivedEmail({
      //     orderId,
      //     orderDate: updatedOrder.createdAt.toLocaleDateString(),
      //     // @ts-ignore
      //     shippingAddress: {
      //       name: session.customer_details!.name!,
      //       city: shippingAddress!.city!,
      //       country: shippingAddress!.country!,
      //       postalCode: shippingAddress!.postal_code!,
      //       street: shippingAddress!.line1!,
      //       state: shippingAddress!.state!,
      //     },
      //   }),
      // });

      const emailContent = render(
        OrderReceivedEmail({
          orderId,
          orderDate: updatedOrder.createdAt.toLocaleDateString(),
          // @ts-ignore
          shippingAddress: {
            name: session.customer_details!.name!,
            city: shippingAddress!.city!,
            country: shippingAddress!.country!,
            postalCode: shippingAddress!.postal_code!,
            street: shippingAddress!.line1!,
            state: shippingAddress!.state!,
          },
        })
      );

      const msg = {
        to: event.data.object.customer_details.email,
        from: "yeminghuhym@gmail.com",
        subject: "Thanks for your order!",
        html: emailContent,
      };

      console.log("Sending email with SendGrid:", msg); // Log the email message before sending

      try {
        await sgMail.send(msg);
        console.log("Email sent successfully"); // Log if email sent successfully
      } catch (sendError) {
        console.error("Error sending email:", sendError); // Log any errors during sending email
      }
    }

    return NextResponse.json({ result: event, ok: true });
  } catch (error) {
    console.error("Error:", error);
    return NextResponse.json(
      { message: "Something went wrong", ok: false },
      { status: 500 }
    );
  }
}
