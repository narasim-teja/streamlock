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
  /**
   * Optional external master secret store.
   * If not provided, secrets are stored in memory (NOT recommended for production).
   * Implement MasterSecretStore interface for persistent/secure storage.
   */
  masterSecretStore?: MasterSecretStore;
  /**
   * Optional external Merkle tree store.
   * If not provided, trees are stored in memory (NOT recommended for production).
   */
  merkleTreeStore?: MerkleTreeStore;
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

/**
 * In-memory master secret store
 *
 * WARNING: NOT SUITABLE FOR PRODUCTION USE
 * - Secrets are lost when the process restarts
 * - No encryption at rest
 * - Not distributed across instances
 *
 * For production, implement MasterSecretStore interface with:
 * - Database storage (PostgreSQL, MySQL)
 * - Secrets manager (AWS Secrets Manager, HashiCorp Vault)
 * - Encrypted file storage
 */
class InMemoryMasterSecretStore implements MasterSecretStore {
  private secrets = new Map<string, Buffer>();
  async set(videoId: string, secret: Buffer): Promise<void> {
    this.secrets.set(videoId, secret);
  }
  async get(videoId: string): Promise<Buffer | null> {
    return this.secrets.get(videoId) ?? null;
  }
  async delete(videoId: string): Promise<void> {
    this.secrets.delete(videoId);
  }
}

/**
 * In-memory Merkle tree store
 *
 * WARNING: NOT SUITABLE FOR PRODUCTION USE
 * - Trees are lost when the process restarts
 * - Merkle proofs cannot be generated after restart
 *
 * For production, implement MerkleTreeStore interface with:
 * - Database storage (store serialized tree JSON)
 * - File storage with backup
 */
class InMemoryMerkleTreeStore implements MerkleTreeStore {
  private trees = new Map<string, MerkleTree>();
  async set(videoId: string, tree: MerkleTree): Promise<void> {
    this.trees.set(videoId, tree);
  }
  async get(videoId: string): Promise<MerkleTree | null> {
    return this.trees.get(videoId) ?? null;
  }
  async delete(videoId: string): Promise<void> {
    this.trees.delete(videoId);
  }
}

/** StreamLock Creator SDK */
export class StreamLockCreator {
  private contract: StreamLockContract;
  private storage: StorageProvider;
  private keyServerBaseUrl: string;
  private secretStore: MasterSecretStore;
  private treeStore: MerkleTreeStore;

  constructor(config: StreamLockCreatorConfig) {
    this.contract = createStreamLockContract(config.aptosClient, {
      address: config.contractAddress,
      moduleName: 'protocol',
    });
    this.storage = config.storageProvider;
    this.keyServerBaseUrl = config.keyServerBaseUrl;

    // Use provided stores or fall back to in-memory (with warning)
    if (!config.masterSecretStore) {
      console.warn(
        '[StreamLockCreator] Using in-memory secret store. ' +
          'For production, implement MasterSecretStore interface for persistent/secure storage.'
      );
    }
    this.secretStore = config.masterSecretStore ?? new InMemoryMasterSecretStore();
    this.treeStore = config.merkleTreeStore ?? new InMemoryMerkleTreeStore();
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
      videoId,
      masterSecret
    );
    onProgress?.('encrypting', 50);

    // Build Merkle tree
    const merkleTree = buildMerkleTree(keys);
    const merkleRoot = getMerkleRoot(merkleTree);
    onProgress?.('encrypting', 100);

    // Store master secret and tree
    await this.secretStore.set(videoId, masterSecret);
    await this.treeStore.set(videoId, merkleTree);

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
      let thumbnailData: Buffer;
      if (typeof options.thumbnail === 'string') {
        // File path - use fs/promises for cross-runtime compatibility
        const { readFile } = await import('fs/promises');
        thumbnailData = await readFile(options.thumbnail);
      } else if (Buffer.isBuffer(options.thumbnail)) {
        thumbnailData = options.thumbnail;
      } else {
        // File object
        thumbnailData = Buffer.from(await options.thumbnail.arrayBuffer());
      }

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

    // Extract video ID from event (on-chain ID is bigint, local ID is string for storage)
    const videoEvent = findEvent(result.events, EVENT_TYPES.VIDEO_REGISTERED);
    const eventData = videoEvent ? parseVideoRegisteredEvent(videoEvent) : null;
    const onChainVideoId = eventData?.videoId ?? 0n;

    return {
      videoId: onChainVideoId,
      localVideoId: videoId, // String ID used for storage paths
      contentUri,
      thumbnailUri,
      totalSegments: segments.length,
      merkleRoot,
      transactionHash: result.hash,
    };
  }

  /**
   * Get videos by creator
   *
   * Uses the Aptos indexer to query VideoRegisteredEvent events and
   * enriches with on-chain video data.
   *
   * Note: This method only returns on-chain data. For full video metadata
   * (title, description), you'll need to store and retrieve from your
   * own database during the upload process.
   *
   * @param creatorAddress - Creator's Aptos address
   * @param limit - Maximum number of videos to return (default: 100)
   * @returns Array of videos with on-chain data
   */
  async getVideos(creatorAddress: string, limit = 100): Promise<Video[]> {
    // Query videos from on-chain using indexer
    const onChainVideos = await this.contract.getVideosByCreator(creatorAddress, limit);

    // Map to Video interface
    return onChainVideos.map((v) => ({
      videoId: v.videoId,
      creator: v.creator,
      title: '', // Not stored on-chain - fetch from your database
      description: '', // Not stored on-chain - fetch from your database
      contentUri: v.contentUri,
      thumbnailUri: v.thumbnailUri || undefined,
      durationSeconds: v.durationSeconds,
      totalSegments: v.totalSegments,
      pricePerSegment: v.pricePerSegment,
      merkleRoot: v.keyCommitmentRoot,
      isActive: v.isActive,
      createdAt: v.createdAt,
    }));
  }

  /** Deactivate a video */
  async deactivateVideo(signer: Account, videoId: bigint): Promise<string> {
    const result = await this.contract.deactivateVideo(signer, videoId);
    return result.hash;
  }

  /** Update video price */
  async updatePrice(
    signer: Account,
    videoId: bigint,
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
      getMasterSecret: async (videoId) => this.secretStore.get(videoId),
      getMerkleTree: async (videoId) => this.treeStore.get(videoId),
    });
  }

  /** Get Merkle tree for a video */
  async getMerkleTree(videoId: string): Promise<MerkleTree | null> {
    return this.treeStore.get(videoId);
  }

  /** Set master secret (for loading from database) */
  async setMasterSecret(videoId: string, secret: Buffer): Promise<void> {
    await this.secretStore.set(videoId, secret);
  }

  /** Set Merkle tree (for loading from database) */
  async setMerkleTree(videoId: string, tree: MerkleTree): Promise<void> {
    await this.treeStore.set(videoId, tree);
  }

  /** Delete video secrets and tree (for cleanup) */
  async deleteVideoSecrets(videoId: string): Promise<void> {
    await this.secretStore.delete(videoId);
    await this.treeStore.delete(videoId);
  }
}
