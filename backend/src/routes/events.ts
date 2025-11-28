import express, { Request, Response } from "express";
import verifyToken from "../middleware/auth";
import User from "../models/user";
import Event, { EventType } from "../models/event"; // this is the model <-------
import Ticket from "../models/ticket";
import mongoose from "mongoose";
import Discount, { DiscountType } from "../models/discount";
import { joinLocation } from "../utils/joinLocation";
import { generateOneSingleEmbedding } from "../middleware/event_des_embed";
import * as eventEmbeddedDescriptionConstants from "../utils/constants/event-embedded-description";
import { Tensor } from "@huggingface/transformers/types/utils/tensor";

const router = express.Router();

router.post("/test", verifyToken, async (req: Request, res: Response) => {
  res.status(200).json({ message: "Test successful" });
});

router.get("/", async (req: Request, res: Response) => {
  try {
    const now = new Date(); // Gets the current date and time
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    // Define an aggregation pipeline to find and process events
    const pipeline: mongoose.PipelineStage[] = [
      { $match: { startTime: { $gte: now } } },
      { $sort: { startTime: 1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $lookup: {
          from: "tickets",
          localField: "_id",
          foreignField: "eventId",
          as: "tickets",
        },
      },
      { $unwind: "$tickets" },
      {
        $group: {
          _id: "$_id",
          title: { $first: "$title" },
          description: { $first: "$description" },
          startTime: { $first: "$startTime" },
          endTime: { $first: "$endTime" },
          venueId: { $first: "$venueId" },
          capacity: { $first: "$capacity" },
          postalCode: { $first: "$postalCode" },
          organizerId: { $first: "$organizerId" },
          location: { $first: "$location" },
          category: { $first: "$category" },
          eventType: { $first: "$eventType" },
          artistName: { $first: "$artistName" },
          imageUrls: { $first: "$imageUrls" },
          roomChatLink: { $first: "$roomChatLink" },
          minPrice: { $min: "$tickets.price" },
        },
      },
    ];

    const events = await Event.aggregate(pipeline);

    // Count total documents for pagination metadata
    const total = await Event.countDocuments({ startTime: { $gte: now } });

    res.status(200).json({
      events,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Failed to fetch events:", error);
    res
      .status(500)
      .json({ message: "Internal server error, unable to fetch events." });
  }
});

router.post("/", verifyToken, async (req: Request, res: Response) => {
  const user = await User.findById(req.userId);
  if (!user) {
    return res.status(400).json({ message: "User does not exists!" });
  }

  const {
    title,
    description,
    startTime,
    endTime,
    venueId,
    capacity,
    location,
    category,
    eventType,
    artistName,
    imageUrls,
    roomChatLink,
  } = req.body;

  if (
    !title ||
    !description ||
    !startTime ||
    !endTime ||
    !endTime ||
    !location ||
    !category ||
    !eventType ||
    !imageUrls
  ) {
    return res.status(400).json({
      message:
        "Missing required fields: Ensure all fields including title, description, start time, end time, location, category, artist name, image URLs are provided.",
    });
  }
  const existingEvent = await Event.findOne({ title, startTime, location });
  if (existingEvent) {
    return res.status(400).json({
      message:
        "An event with the same title, start time and location already exists!",
    });
  }
  const fullAddress = joinLocation(location);
  const event = new Event({
    title,
    description,
    startTime,
    endTime,
    venueId: venueId ? new mongoose.Types.ObjectId(venueId) : undefined,
    capacity,
    organizerId: user._id,
    location: {
      ...location,
      fullAddress,
    },
    category,
    eventType,
    artistName: artistName ? artistName : undefined,
    imageUrls,
    roomChatLink,
  });
  try {
    await event.save();
    return res.status(200).json(event);
  } catch (error) {
    console.error("Failed to create event:", error);
    return res
      .status(500)
      .json({ message: "Failed to create event due to an internal error" });
  }
});

router.post(
  "/:eventId/tickets",
  verifyToken,
  async (req: Request, res: Response) => {
    const { eventId } = req.params;
    const { tickets } = req.body;

    if (!Array.isArray(tickets) || tickets.length === 0) {
      return res.status(400).json({
        message: "Missing required ticket details or tickets array is empty.",
      });
    }

    try {
      const event = await Event.findById(eventId);
      if (!event) {
        return res.status(404).json({ message: "Event not found." });
      }

      for (const ticketData of tickets) {
        const { type, price, quantityAvailable, seatNumber, discount } =
          ticketData;

        if (!type || price == null || quantityAvailable == null) {
          return res
            .status(400)
            .json({ message: "Missing required ticket details." });
        }
        const isFree = price === 0 || price === 0.0 || price === 0.0;
        const ticket = new Ticket({
          eventId,
          status: "active",
          type,
          price,
          quantityAvailable,
          seatNumber,
          isFree,
        });

        await ticket.save();
        event.tickets.push(ticket._id);

        if (discount) {
          const {
            code,
            discount: amount,
            type,
            validUntil,
            usageLimit,
          } = discount;
          if (!code || !amount || !validUntil || !usageLimit) {
            return res
              .status(400)
              .json({ message: "Missing required discount details." });
          }
          let discountData: DiscountType = {
            eventId: new mongoose.Types.ObjectId(event._id),
            ticketId: ticket._id,
            code,
            validUntil,
            isActive: true,
            usageLimit,
            usedCount: 0,
          };
          if (type === "percentage") {
            discountData = { ...discountData, percentage: amount };
          } else if (type === "number") {
            discountData = { ...discountData, number: amount };
          }

          const createdDiscount = new Discount(discountData);
          await createdDiscount.save();
        }
      }

      await event.save();

      return res.status(201).json({
        message: "Tickets created successfully",
      });
    } catch (error) {
      console.error("Failed to create tickets:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

router.delete(
  "/:ticketId/deleteTicket",
  verifyToken,
  async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      const ticket = await Ticket.findById(req.query.ticketId);
      if (!ticket) {
        return res.status(404).send({ message: "Ticket not found" });
      }
      const event = await Event.findOneAndUpdate(
        { _id: ticket.eventId, organizerId: userId },
        { $pull: { tickets: req.query.ticketId } },
        { new: true } // Return the updated document
      );
      if (!event) {
        return res.status(404).send({
          message: "Event of this ticket not found/not created by this user",
        });
      }
      await Ticket.findByIdAndDelete(req.query.ticketId);
      res
        .status(200)
        .json({ message: "Ticket deleted successfully", deleted: ticket });
    } catch (error) {
      console.log("Fail to delete ticket", error);
      res.status(500).send({ message: "Internal server error" });
    }
  }
);
router.delete(
  "/:eventId/deleteEvent",
  verifyToken,
  async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      const { eventId } = req.params; // Extract eventId from params
      console.log(eventId);
      // Find and delete the event
      const event = await Event.findOneAndDelete({
        organizerId: userId,
        _id: eventId,
      });

      if (!event) {
        return res
          .status(404)
          .json({ message: "Event not found/not created by this user" });
      }

      // Delete all tickets associated with the event
      await Ticket.deleteMany({ eventId });

      res
        .status(200)
        .json({ message: "Event deleted successfully", deleted: event });
    } catch (error) {
      console.log("Fail to delete event", error);
      res.status(500).send({ message: "Internal server error" });
    }
  }
);

router.patch(
  "/:ticketId/updateTicket",
  verifyToken,
  async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      let ticket = await Ticket.findById(req.query.ticketId);
      if (!ticket) {
        return res.status(404).send({ message: "Ticket not found" });
      }
      const event = await Event.findOne({
        _id: ticket.eventId,
        organizerId: userId,
      });
      if (!event) {
        return res.status(404).send({
          message: "Event of this ticket not found/not created by this user",
        });
      }
      ticket = await Ticket.findByIdAndUpdate(req.query.ticketId, req.body, {
        new: true,
      });
      res
        .status(200)
        .json({ message: "Ticket updated successfully", updated: ticket });
    } catch (error) {
      console.log("Fail to update ticket", error);
      res.status(500).send({ message: "Internal server error" });
    }
  }
);

router.get("/:eventId/details", async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
    // Populate the 'tickets' field when fetching the event
    const event = await Event.findById(eventId)
      .populate({
        path: "organizerId",
        select: "username imageUrl",
      })
      .populate("tickets")
      .exec();

    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    return res.status(200).json(event);
  } catch (error) {
    console.error("Failed to fetch event:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/filter", async (req: Request, res: Response) => {
  try {
    let {
      sort,
      location,
      keyword,
      startTime,
      endTime,
      priceMin,
      priceMax,
      category,
      eventType,
    } = req.query;

    if (location == undefined) {
      location = "";
    }

    if (category == "All event categories" || category == undefined) {
      category = "";
    }

    if (eventType == "All event types" || eventType == undefined) {
      eventType = "";
    }

    if (keyword == undefined) {
      keyword = "";
    }

    const regexEventType = new RegExp(String(eventType), "i"); // Create a regular expression with the variable and make it case-insensitive
    const regexCategory = new RegExp(String(category), "i");
    const regexKeyword = new RegExp(String(keyword), "i");
    const regexLocation = new RegExp(String(location), "i");
    const embeddingKeyword = await generateOneSingleEmbedding(String(keyword));
    
    //if no endDate input, we let it be one day after startDate (so that we only filter by event within the day)
    if (startTime && !endTime) {
      const date = new Date(String(startTime).split("T")[0]);
      date.setDate(date.getDate() + 1);
      endTime = date.toISOString();
    }
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 8;
    const skip = (page - 1) * limit;

    const collectionSize = await Event.estimatedDocumentCount();

    const pipeline: mongoose.PipelineStage[] = [
      { $vectorSearch: 
        { index: "default",
          path: "embeddedDescription",
          queryVector: embeddingKeyword,
          numCandidates: collectionSize,
          limit: 200
        }
      },
      {
        $match: {
          $and: [
            {
              $or: [
                { title: { $regex: regexKeyword } },
                { "location.fullAddress": { $regex: regexKeyword } },
                { artistName: { $regex: regexKeyword } },
                { description: { $regex: regexKeyword } }, 
                { description: { $regex: RegExp("", "i") } }
              ],
            },
            { "location.fullAddress": { $regex: regexLocation } },
            { eventType: { $regex: regexEventType } },
            { category: { $regex: regexCategory } },
          ],
        },
      },
      {
        $lookup: {
          from: "tickets",
          localField: "_id",
          foreignField: "eventId",
          as: "tickets",
        },
      },
      {
        $addFields: {
          minPrice: { $min: "$tickets.price" },
          maxPrice: { $max: "$tickets.price" },
        },
      },
      {
        $match: {
          $or: [
            {
              minPrice: {
                $gte: priceMin ? parseFloat(priceMin as string) : -Infinity,
                $lte: priceMax ? parseFloat(priceMax as string) : Infinity,
              },
            },
            {
              maxPrice: {
                $gte: priceMin ? parseFloat(priceMin as string) : -Infinity,
                $lte: priceMax ? parseFloat(priceMax as string) : Infinity,
              },
            },
            {
              $and: [
                {
                  minPrice: {
                    $lte: priceMin ? parseFloat(priceMin as string) : -Infinity,
                  },
                },
                {
                  maxPrice: {
                    $gte: priceMax ? parseFloat(priceMax as string) : Infinity,
                  },
                },
              ],
            },
          ],
        },
      },
      {
        $addFields: {
          dotProduct: {
            $sum: {
              $map: {
                input: { $range: [0, { $size: "$embeddedDescription" }] },
                as: "i",
                in: {
                  $multiply: [
                    { $arrayElemAt: ["$embeddedDescription", "$$i"] },
                    { $arrayElemAt: [embeddingKeyword, "$$i"] } // embeddingKeyword is a JS array
                  ]
                }
              }
            }
          },
          magnitudeA: {
            $sqrt: {
              $sum: {
                $map: {
                  input: { $range: [0, { $size: "$embeddedDescription" }] },
                  as: "i",
                  in: { $pow: [{ $arrayElemAt: ["$embeddedDescription", "$$i"] }, 2] }
                }
              }
            }
          },
          magnitudeB: {
            $sqrt: {
              $sum: {
                $map: {
                  input: { $range: [0, 384] },
                  as: "i",
                  in: { $pow: [{ $arrayElemAt: [embeddingKeyword, "$$i"] }, 2] }
                }
              }
            }
          }
        }
      },
      {
        $addFields: {
          cosineSimilarity: {
            $divide: ["$dotProduct", { $multiply: ["$magnitudeA", "$magnitudeB"] }]
          }
        }
      },
      {
        $addFields: {
          matchCount: {
            $add: [
              { $cond: [{ $regexMatch: { input: "$title", regex: regexKeyword} }, 1, 0] },
              { $cond: [{ $regexMatch: { input: "$location.fullAddress", regex: regexKeyword} }, 1, 0] },
              { $cond: [{ $regexMatch: { input: "$artistName", regex: regexKeyword} }, 1, 0] },
              { $cond: [{ $regexMatch: { input: "$description", regex: regexKeyword} }, 1, 0] }
            ]
          }
        }
      },
      {
        $addFields: {
          overallSimilarity: { $multiply: ["$cosineSimilarity", "$matchCount"] }
        }
      },
      { $sort: { overallSimilarity: -1 } }
    ];

    //if date is given, match by date as well
    if (startTime) {
      pipeline.push({
        $match: {
          $or: [
            {
              startTime: {
                $gte: new Date(String(startTime)),
                $lte: new Date(String(endTime)),
              },
            },
            {
              endTime: {
                $gte: new Date(String(startTime)),
                $lte: new Date(String(endTime)),
              },
            },
            {
              $and: [
                { startTime: { $lte: new Date(String(startTime)) } },
                { endTime: { $gte: new Date(String(endTime)) } },
              ],
            },
          ],
        },
      });
    }
    
    let eventMatchedAll = await Event.aggregate(pipeline);
    const total = eventMatchedAll.length;

    switch (sort) {
      case "Soonest":
        pipeline.push({ $sort: { startTime: 1 } }, { $sort: { endTime: 1 } });
        break;
      case "Latest":
        pipeline.push({ $sort: { startTime: -1 } }, { $sort: { endTime: -1 } });
        break;
      case "Price low to high":
        pipeline.push({ $sort: { minPrice: 1 } }, { $sort: { maxPrice: 1 } });
        break;
      case "Price high to low":
        pipeline.push({ $sort: { minPrice: -1 } }, { $sort: { maxPrice: -1 } });
        break;
      default:
        break;
    }
    pipeline.push({ $skip: skip }, { $limit: limit });
    const eventMatched = await Event.aggregate(pipeline);

    res.status(200).json({
      eventMatched,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Failed to fetch event:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.delete(
  "/:eventId/deleteEvent",
  verifyToken,
  async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      const event = await Event.findOneAndDelete({
        $and: [{ organizerId: userId }, { _id: req.params.eventId }],
      });

      if (!event) {
        return res
          .status(404)
          .json({ message: "Event not found/not created by this user" });
      }
      await Ticket.deleteMany({ eventId: req.params.eventId });
      res
        .status(200)
        .json({ message: "Event deleted successfully", deleted: event });
    } catch (error) {
      console.log("Fail to delete event", error);
      res.status(500).send({ message: "Internal server error" });
    }
  }
);

router.put(
  "/:eventId/updateEvent",
  verifyToken,
  async (req: Request, res: Response) => {
    try {
      console.log("Request to update event:", req.params.eventId, req.body);

      // Extract location details from req.body
      const { city, postalCode, country, state } = req.body.location || {};

      // Construct the fullAddress field
      const fullAddress =
        `${city || ""}, ${state || ""}, ${postalCode || ""}, ${country || ""}`
          .trim()
          .replace(/\s*,\s*$/, "");

      // Update req.body with the constructed location object
      req.body.location = {
        ...req.body.location,
        fullAddress,
      };

      const event = await Event.findOneAndUpdate(
        { $and: [{ organizerId: req.userId }, { _id: req.params.eventId }] },
        req.body,
        { new: true }
      );

      if (!event) {
        return res
          .status(404)
          .json({ message: "Event not found/not created by this user" });
      }

      res
        .status(200)
        .json({ message: "Event updated successfully", updated: event });
    } catch (error) {
      console.error("Failed to update event:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

//route to fetch all event created by the given user
router.get("/fetch", verifyToken, async (req: Request, res: Response) => {
  try {
    const event = await Event.find({ organizerId: req.userId });

    if (!event || event.length === 0) {
      return res
        .status(404)
        .json({ message: "Event not found/not created by this user" });
    }
    res.status(200).json({
      message: "Event created by this user fetched successfully",
      event: event,
    });
  } catch (error) {
    console.error("Failed to fetch event:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/addEmbeddedDescriptions", async (req: Request, res: Response) => {
  try {
    const batchSize = eventEmbeddedDescriptionConstants.eventEmbeddedDesWriteBatchSize;
    const eventsId: string[] = req.body.eventsId || [];

    const embeddedDescriptions: Record<string, number[]> = {};
    for (const id of eventsId) {
      embeddedDescriptions[id] = (await generateOneSingleEmbedding(id));
    }

    for (let i = 0; i < eventsId.length; i += batchSize) {
      const batch = eventsId.slice(i, i + batchSize);

      const ops = batch.map((id) => ({
        updateOne: {
          filter: { _id: new mongoose.Types.ObjectId(id) },
          update: { $set: { embeddedDescription: embeddedDescriptions[id] } },
        },
      }));

      if (ops.length > 0) {
        await Event.collection.bulkWrite(ops, { ordered: false });
      }

    }

    res.status(200).json({ message: "Embedded descriptions updated successfully" });
  } catch (error) {
    console.error("Failed to add embedded description:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/addOneEmbeddedDes", async (req: Request, res: Response) => {
  try {
    const eventId: string = req.body.eventId;
    let theEvent = await Event.findById(eventId);
    if (!theEvent) {
      return res.status(404).json({ message: "Event not found" });
    }
    const embeddedDescriptions = (await generateOneSingleEmbedding(theEvent.description));
    const batch = [eventId];

    const ops = batch.map((id) => ({
      updateOne: {
        filter: { _id: new mongoose.Types.ObjectId(id) },
        update: { $set: { embeddedDescription: embeddedDescriptions} },
      },
    }));

    if (ops.length > 0) {
      await Event.collection.bulkWrite(ops, { ordered: false });
    }
    console.log(embeddedDescriptions);
    res.status(200).json({ message: "Embedded descriptions updated successfully", data: embeddedDescriptions });
  } catch (error) {
    console.error("Failed to add embedded description:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// router.get("/allEventsId", async (req: Request, res: Response) => {
//   try {
//     const events = await Event.find({}, { _id: 1 });
//     const eventIds = events.map(event => event._id);
//     res.status(200).json({ eventIds });

//   } catch (error) {
//     console.error("Failed to fetch event IDs:", error);
//     res.status(500).json({ message: "Internal server error" });
//   }
// });

// // Preserve events and their tickets in-place: for each id in `eventsId`,
// // re-write (replace) the event document and any tickets that reference it using upsert.
// // This preserves the original `_id` values (no duplicates) and is suitable for
// // re-inserting or normalizing documents.
// router.get(
//   "/preserve",
//   async (req: Request, res: Response) => {
//     try {
//       const events = await Event.find({}, { _id: 1 }); // Fetch only the _id field
//       const eventsId = events.map(event => event._id); // Extract the _id values    
//       if (!Array.isArray(eventsId) || eventsId.length === 0) {
//         return res.status(400).json({ message: "eventsId array is required" });
//       }
//       console.log("Preserving events:", eventsId);

//       const result: Record<
//         string,
//         { event: boolean; tickets: Record<string, boolean> }
//       > = {};

//       console.log("pass2");

//       for (const id of eventsId) {
//         try {
//           const eventDoc = await Event.findById(id).lean();
//           if (!eventDoc) {
//             result[id] = { event: false, tickets: {} };
//             continue;
//           }

//           // Replace the event document with an upsert to preserve the _id
//           await Event.replaceOne({ _id: eventDoc._id }, eventDoc as any, {
//             upsert: true,
//           });

//           // Find tickets that reference this event and upsert them as well
//           const tickets = await Ticket.find({ eventId: id }).lean();
//           const ticketResults: Record<string, boolean> = {};
//           for (const ticket of tickets) {
//             try {
//               await Ticket.replaceOne({ _id: ticket._id }, ticket as any, {
//                 upsert: true,
//               });
//               ticketResults[String(ticket._id)] = true;
//             } catch (tErr) {
//               console.error(`Failed to upsert ticket ${ticket._id}:`, tErr);
//               ticketResults[String(ticket._id)] = false;
//             }
//           }

//           result[id] = { event: true, tickets: ticketResults };
//         } catch (err) {
//           console.error(`Failed to preserve event ${id}:`, err);
//           result[id] = { event: false, tickets: {} };
//         }
//       }

//       res.status(200).json({ preserved: result });
//     } catch (error) {
//       console.error("Failed to preserve events:", error);
//       res.status(500).json({ message: "Internal server error" });
//     }
//   },
// );

router.post("/searchEvents", async (req: Request, res: Response) => {
  const query = req.body.query as string;
  if (!query) {
    return res.status(400).json({ message: "Missing query in request body" });
  }

  try {
    const embedding = await generateOneSingleEmbedding(query);
    const results = await Event.aggregate([
      {
        $vectorSearch: {
          index: "default",
          path: "embeddedDescription",
          queryVector: embedding,
          numCandidates: 200,
          limit: 10
        }
      },
    ]);

    res.status(200).json({ results });

  } catch (error) {
    console.error("Vector search failed:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});


export default router;
