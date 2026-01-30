/**
 * Main StreamLockCreator class
 */

import type { Aptos, Account } from '@aptos-labs/ts-sdk';
import type {
  UploadVideoOptions,
  UploadResult,
  Creator,
  Video,
} from '@streamlock/common';
import { aptToOctas } from '@streamlock/common';
import {
  generateMasterSecret,
  deriveAllSegmentKeys,
  buildMerkleTree,
  getMerkleRoot,
  type MerkleTree,
} from '@streamlock/crypto';
import {
  StreamLockContract,
  createStreamLockContract,
  parseVideoRegisteredEvent,
  findEvent,
  EVENT_TYPES,
} from '@streamlock/aptos';
import { segmentVideo } from './video/segmenter.js';
import { encryptVideoSegments } from './video/encryptor.js';
import { generateHLSPackage } from './video/packager.js';
import type { StorageProvider } from './storage/provider.js';
import { createKeyHandler, type KeyHandler } from './server/keyHandler.js';

/** Creator SDK configuration */
export interface StreamLockCreatorConfig {
  aptosClient: Aptos;
  contractAddress: string;
  storageProvider: StorageProvider;
  keyServerBaseUrl: string;
}

/** Master secret store interface */
export interface MasterSecretStore {
  set(videoId: string, secret: Buffer): Promise<void>;
  get(videoId: string): Promise<Buffer | null>;
  delete(videoId: string): Promise<void>;
}

/** Merkle tree store interface */
export interface MerkleTreeStore {
  set(videoId: string, tree: MerkleTree): Promise<void>;
  get(videoId: string): Promise<MerkleTree | null>;
  delete(videoId: string): Promise<void>;
}

/** Creator metadata for registration */
export interface CreatorMetadata {
  name?: string;
  description?: string;
  website?: string;
  avatar?: string;
}

/** StreamLock Creator SDK */
export class StreamLockCreator {
  private contract: StreamLockContract;
  private storage: StorageProvider;
  private keyServerBaseUrl: string;
  private masterSecrets: Map<string, Buffer> = new Map();
  private merkleTrees: Map<string, MerkleTree> = new Map();

  constructor(config: StreamLockCreatorConfig) {
    this.contract = createStreamLockContract(config.aptosClient, {
      address: config.contractAddress,
      moduleName: 'protocol',
    });
    this.storage = config.storageProvider;
    this.keyServerBaseUrl = config.keyServerBaseUrl;
  }

  /** Register as a creator */
  async register(
    signer: Account,
    metadata: CreatorMetadata
  ): Promise<string> {
    const metadataUri = JSON.stringify(metadata);
    const result = await this.contract.registerCreator(signer, {
      metadataUri,
    });
    return result.hash;
  }

  /** Check if address is registered as creator */
  async isRegistered(address: string): Promise<boolean> {
    const creator = await this.contract.getCreator(address);
    return creator !== null;
  }

  /** Get creator profile */
  async getProfile(address: string): Promise<Creator | null> {
    const onChain = await this.contract.getCreator(address);
    if (!onChain) return null;

    return {
      address,
      totalEarnings: onChain.totalEarnings,
      pendingWithdrawal: onChain.pendingWithdrawal,
      totalVideos: onChain.totalVideos,
      registeredAt: onChain.registeredAt,
      metadataUri: onChain.metadataUri,
    };
  }

  /** Upload and register a video */
  async uploadVideo(
    signer: Account,
    options: UploadVideoOptions,
    onProgress?: (stage: string, progress: number) => void
  ): Promise<UploadResult> {
    const segmentDuration = options.segmentDuration ?? 5;
    const pricePerSegmentOctas = aptToOctas(options.pricePerSegment);

    // Stage 1: Segment video
    onProgress?.('segmenting', 0);
    const segments = await segmentVideo(options.file, {
      segmentDuration,
      quality: '720p',
    });
    onProgress?.('segmenting', 100);

    // Generate video ID
    const videoId = crypto.randomUUID().replace(/-/g, '');

    // Stage 2: Generate master secret and encrypt
    onProgress?.('encrypting', 0);
    const masterSecret = generateMasterSecret();
    const keys = deriveAllSegmentKeys(masterSecret, videoId, segments.length);
    const { encryptedSegments, ivs } = await encryptVideoSegments(
      segments,
      keys,
      videoId
    );
    onProgress?.('encrypting', 50);

    // Build Merkle tree
    const merkleTree = buildMerkleTree(keys);
    const merkleRoot = getMerkleRoot(merkleTree);
    onProgress?.('encrypting', 100);

    // Store master secret and tree locally
    this.masterSecrets.set(videoId, masterSecret);
    this.merkleTrees.set(videoId, merkleTree);

    // Stage 3: Generate HLS package
    onProgress?.('packaging', 0);
    const hlsPackage = generateHLSPackage(
      encryptedSegments,
      ivs,
      videoId,
      this.keyServerBaseUrl
    );
    onProgress?.('packaging', 100);

    // Stage 4: Upload to storage
    onProgress?.('uploading', 0);
    const uploadFiles = [
      {
        path: `${videoId}/master.m3u8`,
        data: Buffer.from(hlsPackage.masterPlaylist),
        contentType: 'application/vnd.apple.mpegurl',
      },
    ];

    // Add media playlists
    for (const [quality, playlist] of hlsPackage.mediaPlaylists) {
      uploadFiles.push({
        path: `${videoId}/${quality}/playlist.m3u8`,
        data: Buffer.from(playlist),
        contentType: 'application/vnd.apple.mpegurl',
      });
    }

    // Add encrypted segments
    for (const [segPath, data] of hlsPackage.segments) {
      uploadFiles.push({
        path: `${videoId}/${segPath}`,
        data: Buffer.from(data),
        contentType: 'video/MP2T',
      });
    }

    const uploadedUrls = await this.storage.uploadBatch(uploadFiles);
    const contentUri = uploadedUrls.get(`${videoId}/master.m3u8`)!;
    onProgress?.('uploading', 100);

    // Upload thumbnail if provided
    let thumbnailUri = '';
    if (options.thumbnail) {
      const thumbnailData =
        typeof options.thumbnail === 'string'
          ? await Bun.file(options.thumbnail).arrayBuffer().then(Buffer.from)
          : Buffer.isBuffer(options.thumbnail)
            ? options.thumbnail
            : await options.thumbnail.arrayBuffer().then(Buffer.from);

      thumbnailUri = await this.storage.upload(
        `${videoId}/thumbnail.jpg`,
        thumbnailData,
        'image/jpeg'
      );
    }

    // Stage 5: Register on-chain
    onProgress?.('registering', 0);
    const totalDuration = segments.reduce((sum, s) => sum + s.duration, 0);
    const result = await this.contract.registerVideo(signer, {
      contentUri,
      thumbnailUri,
      durationSeconds: Math.ceil(totalDuration),
      totalSegments: segments.length,
      keyCommitmentRoot: merkleRoot,
      pricePerSegment: pricePerSegmentOctas,
    });
    onProgress?.('registering', 100);

    // Extract video ID from event
    const videoEvent = findEvent(result.events, EVENT_TYPES.VIDEO_REGISTERED);
    const eventData = videoEvent ? parseVideoRegisteredEvent(videoEvent) : null;

    return {
      videoId: eventData?.videoId ?? videoId,
      contentUri,
      thumbnailUri,
      totalSegments: segments.length,
      merkleRoot,
      transactionHash: result.hash,
    };
  }

  /** Get videos by creator */
  async getVideos(_creatorAddress: string): Promise<Video[]> {
    // This would need to be implemented via indexer or events
    // For now, return empty array
    return [];
  }

  /** Deactivate a video */
  async deactivateVideo(signer: Account, videoId: string): Promise<string> {
    const result = await this.contract.deactivateVideo(signer, videoId);
    return result.hash;
  }

  /** Update video price */
  async updatePrice(
    signer: Account,
    videoId: string,
    newPriceApt: number
  ): Promise<string> {
    const priceOctas = aptToOctas(newPriceApt);
    const result = await this.contract.updateVideoPrice(signer, videoId, priceOctas);
    return result.hash;
  }

  /** Get earnings info */
  async getEarnings(address: string): Promise<{ total: bigint; pending: bigint }> {
    const creator = await this.contract.getCreator(address);
    if (!creator) {
      return { total: 0n, pending: 0n };
    }
    return {
      total: creator.totalEarnings,
      pending: creator.pendingWithdrawal,
    };
  }

  /** Withdraw earnings */
  async withdraw(signer: Account): Promise<string> {
    const result = await this.contract.withdrawEarnings(signer);
    return result.hash;
  }

  /** Get key handler for API routes */
  getKeyHandler(): KeyHandler {
    return createKeyHandler({
      getMasterSecret: async (videoId) => this.masterSecrets.get(videoId) ?? null,
      getMerkleTree: async (videoId) => this.merkleTrees.get(videoId) ?? null,
    });
  }

  /** Get Merkle tree for a video */
  getMerkleTree(videoId: string): MerkleTree | null {
    return this.merkleTrees.get(videoId) ?? null;
  }

  /** Set master secret (for loading from database) */
  setMasterSecret(videoId: string, secret: Buffer): void {
    this.masterSecrets.set(videoId, secret);
  }

  /** Set Merkle tree (for loading from database) */
  setMerkleTree(videoId: string, tree: MerkleTree): void {
    this.merkleTrees.set(videoId, tree);
  }
}
